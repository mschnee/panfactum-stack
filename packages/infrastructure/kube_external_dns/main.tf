terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.34.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "2.12.1"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "5.80.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "2.1.3"
    }
    pf = {
      source  = "panfactum/pf"
      version = "0.0.7"
    }
  }
}

locals {

  name      = "external-dns"
  namespace = module.namespace.namespace

  all_roles = toset([for domain, config in var.route53_zones : config.record_manager_role_arn])

  all_domains = concat(
    keys(var.cloudflare_zones),
    keys(var.route53_zones)
  )

  cloudflare_config = { for domain, config in var.cloudflare_zones : domain => {
    labels   = { domain : sha1(domain) }
    provider = "cloudflare"

    included_domains = [domain]
    excluded_domains = [
      for excluded_domain, config in local.all_domains :
      excluded_domain
      if excluded_domain != domain &&
      alltrue([
        for included_domain, config in local.all_domains :
        !endswith(included_domain, excluded_domain) || included_domain == excluded_domain
      ])
    ]

    env = [
      { name = "CF_API_TOKEN", value = var.cloudflare_api_token }
    ]
    extra_args = ["--zone-id-filter=${config.zone_id}", "--cloudflare-dns-records-per-page=5000"]
  } }


  aws_config = { for role in local.all_roles : role => {
    labels   = { role : sha1(role) }
    provider = "aws"

    included_domains = [for domain, config in var.route53_zones : domain if config.record_manager_role_arn == role]
    excluded_domains = [for domain, config in var.route53_zones : domain if config.record_manager_role_arn != role && alltrue([for includedDomain, config in var.route53_zones : !endswith(includedDomain, domain) if config.record_manager_role_arn == role])] // never exclude an ancestor of an included domain
    env = [
      { name = "AWS_REGION", value = data.aws_region.main.name }
    ]
    extra_args = concat(
      [
        "--aws-assume-role=${role}"
      ],
      [for zone_id in [for domain, config in var.route53_zones : config.zone_id if config.record_manager_role_arn == role] : "--zone-id-filter=${zone_id}"]
    )
  } }

  config = merge(local.cloudflare_config, local.aws_config)
}

data "pf_kube_labels" "labels" {
  module = "kube_external_dns"
}

resource "random_id" "ids" {
  for_each    = local.config
  prefix      = "${local.name}-"
  byte_length = 8
}

module "util" {
  for_each = local.config
  source   = "../kube_workload_utility"

  workload_name                        = "external-dns"
  match_labels                         = { id = random_id.ids[each.key].hex }
  burstable_nodes_enabled              = var.burstable_nodes_enabled
  controller_nodes_enabled             = var.controller_nodes_enabled
  spot_nodes_enabled                   = var.spot_nodes_enabled
  panfactum_scheduler_enabled          = var.panfactum_scheduler_enabled
  pull_through_cache_enabled           = var.pull_through_cache_enabled
  instance_type_anti_affinity_required = false
  az_spread_preferred                  = false
  extra_labels                         = data.pf_kube_labels.labels.labels
}

module "constants" {
  source = "../kube_constants"
}

/***************************************
* AWS Permissions
***************************************/

data "aws_region" "main" {}

data "aws_iam_policy_document" "permissions" {
  for_each = local.aws_config
  statement {
    effect    = "Allow"
    actions   = ["sts:AssumeRole"]
    resources = [each.key]
  }
}

resource "kubernetes_service_account" "external_dns" {
  for_each = local.config
  metadata {
    name      = random_id.ids[each.key].hex
    namespace = local.namespace
    labels    = module.util[each.key].labels
  }
}

module "aws_permissions" {
  for_each = local.aws_config

  source = "../kube_sa_auth_aws"

  service_account           = kubernetes_service_account.external_dns[each.key].metadata[0].name
  service_account_namespace = local.namespace
  iam_policy_json           = data.aws_iam_policy_document.permissions[each.key].json
  ip_allow_list             = var.aws_iam_ip_allow_list
}


/***************************************
* Kubernetes Resources
***************************************/

module "namespace" {
  source = "../kube_namespace"

  namespace = local.name
}

resource "helm_release" "external_dns" {
  for_each        = local.config
  namespace       = local.namespace
  name            = random_id.ids[each.key].hex
  repository      = "https://kubernetes-sigs.github.io/external-dns"
  chart           = "external-dns"
  version         = var.external_dns_helm_version
  recreate_pods   = false
  atomic          = var.wait
  cleanup_on_fail = var.wait
  wait            = var.wait
  force_update    = true
  wait_for_jobs   = true
  max_history     = 5

  values = [
    yamlencode({
      nameOverride = random_id.ids[each.key].hex
      commonLabels = module.util[each.key].labels
      podLabels = merge(
        module.util[each.key].labels,
        {
          customizationHash = md5(join("", [
            for filename in sort(fileset(path.module, "kustomize/*")) : filesha256(filename)
          ]))
        }
      )
      deploymentAnnotations = {
        "reloader.stakater.com/auto" = "true"
      }
      serviceAccount = {
        create = false
        name   = kubernetes_service_account.external_dns[each.key].metadata[0].name
      }
      logLevel  = var.log_level
      logFormat = "json"

      tolerations       = module.util[each.key].tolerations
      priorityClassName = module.constants.cluster_important_priority_class_name

      resources = {
        requests = {
          memory = "100Mi"
        }
        limits = {
          memory = "130Mi"
        }
      }

      // For the metrics server
      service = {
        enabled = true
        ports = {
          http = 7979
        }
      }

      // Monitoring
      serviceMonitor = {
        enabled   = var.monitoring_enabled
        namespace = local.namespace
        interval  = "60s"
      }

      // Provider configuration
      provider = {
        name = each.value.provider
      }

      domainFilters  = each.value.included_domains
      excludeDomains = each.value.excluded_domains

      extraArgs = each.value.extra_args
      env       = each.value.env

      sources    = ["service", "ingress"]
      policy     = var.sync_policy
      txtOwnerId = random_id.ids[each.key].hex
      txtPrefix  = "external-dns-"
    })
  ]

  depends_on = [module.aws_permissions]
}

resource "kubernetes_config_map" "dashboard" {
  count = var.monitoring_enabled ? 1 : 0
  metadata {
    name   = "external-dns-dashboard"
    labels = { "grafana_dashboard" = "1" }
  }
  data = {
    "external-dns.json" = file("${path.module}/dashboard.json")
  }
}

resource "kubectl_manifest" "vpa" {
  for_each = var.vpa_enabled ? local.config : {}
  yaml_body = yamlencode({
    apiVersion = "autoscaling.k8s.io/v1"
    kind       = "VerticalPodAutoscaler"
    metadata = {
      name      = random_id.ids[each.key].hex
      namespace = local.namespace
      labels    = module.util[each.key].labels
    }
    spec = {
      resourcePolicy = {
        containerPolicies = [{
          containerName = "external-dns"
          minAllowed = {
            memory = "100Mi"
          }
        }]
      }
      updatePolicy = {
        updateMode = "Auto"
        evictionRequirements = [{
          resources         = ["cpu", "memory"]
          changeRequirement = "TargetHigherThanRequests"
        }]
      }
      targetRef = {
        apiVersion = "apps/v1"
        kind       = "Deployment"
        name       = random_id.ids[each.key].hex
      }
    }
  })
  force_conflicts   = true
  server_side_apply = true
  depends_on        = [helm_release.external_dns]
}

resource "kubectl_manifest" "pdb" {
  for_each = local.config
  yaml_body = yamlencode({
    apiVersion = "policy/v1"
    kind       = "PodDisruptionBudget"
    metadata = {
      name      = "${local.name}-${random_id.ids[each.key].hex}"
      namespace = local.namespace
      labels    = module.util[each.key].labels
    }
    spec = {
      unhealthyPodEvictionPolicy = "AlwaysAllow"
      selector = {
        matchLabels = { id = random_id.ids[each.key].hex }
      }
      maxUnavailable = 1
    }
  })
  force_conflicts   = true
  server_side_apply = true
  depends_on        = [helm_release.external_dns]
}
