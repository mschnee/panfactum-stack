terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.34.0"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "2.1.3"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "2.12.1"
    }
    pf = {
      source  = "panfactum/pf"
      version = "0.0.7"
    }
  }
}

locals {
  name      = "metrics-server"
  namespace = module.namespace.namespace
}

data "pf_kube_labels" "labels" {
  module = "kube_metrics_server"
}

module "util" {
  source = "../kube_workload_utility"

  workload_name                        = "metrics-server"
  burstable_nodes_enabled              = var.burstable_nodes_enabled
  spot_nodes_enabled                   = var.spot_nodes_enabled
  controller_nodes_enabled             = var.controller_nodes_enabled
  panfactum_scheduler_enabled          = var.panfactum_scheduler_enabled
  pull_through_cache_enabled           = var.pull_through_cache_enabled
  instance_type_anti_affinity_required = var.sla_target == 3
  az_spread_preferred                  = var.sla_target >= 2
  host_anti_affinity_required          = var.sla_target >= 2
  extra_labels                         = data.pf_kube_labels.labels.labels
}

module "constants" {
  source = "../kube_constants"
}

/***************************************
* Kubernetes Resources
***************************************/

module "namespace" {
  source = "../kube_namespace"

  namespace = local.name
}

module "cert" {
  source = "../kube_internal_cert"

  secret_name   = "metrics-server-tls"
  service_names = ["metrics-server"]
  namespace     = local.namespace
}


resource "helm_release" "metrics_server" {
  namespace       = local.namespace
  name            = "metrics-server"
  repository      = "https://kubernetes-sigs.github.io/metrics-server/"
  chart           = "metrics-server"
  version         = var.metrics_server_helm_version
  recreate_pods   = false
  atomic          = var.wait
  cleanup_on_fail = var.wait
  wait            = var.wait
  force_update    = true
  wait_for_jobs   = true
  max_history     = 5

  values = [
    yamlencode({
      commonLabels = module.util.labels
      podLabels    = module.util.labels
      deploymentAnnotations = {
        "reloader.stakater.com/auto" = "true"
      }

      args = [
        "--v=${var.log_verbosity}",
        "--logging-format=json",
        "--metric-resolution=15s", // kubelets only scrape every 15s so any lower would be pointless
        "--tls-cert-file=/etc/certs/tls.crt",
        "--tls-private-key-file=/etc/certs/tls.key",
        "--tls-min-version=VersionTLS13"
      ]

      resources = {
        requests = {
          memory = "100Mi"
        }
        limits = {
          memory = "130Mi"
        }
      }

      ///////////////////////////////////////
      // Monitoring
      ////////////////////////////////////////
      serviceMonitor = {
        enabled  = var.monitoring_enabled
        interval = "60s"
      }

      ///////////////////////////////////////
      // High Availability Config
      ////////////////////////////////////////
      replicas                  = 2
      affinity                  = module.util.affinity
      topologySpreadConstraints = module.util.topology_spread_constraints
      tolerations               = module.util.tolerations
      podDisruptionBudget = {
        enabled      = true
        minAvailable = 1
      }
      priorityClassName   = module.constants.cluster_important_priority_class_name
      podDisruptionBudget = { enabled = false } # Created below
      schedulerName       = var.panfactum_scheduler_enabled ? module.constants.panfactum_scheduler_name : "default-scheduler"
      updateStrategy = {
        type = "RollingUpdate"
        rollingUpdate = {
          maxSurge       = 0
          maxUnavailable = 1
        }
      }

      ///////////////////////////////////////
      // Custom Cert Config
      ////////////////////////////////////////
      extraVolumeMounts = [{
        name      = "certs"
        mountPath = "/etc/certs"
      }]
      extraVolumes = [{
        name = "certs"
        secret = {
          secretName = module.cert.secret_name
          optional   = false
        }
      }]
      apiService = {
        insecureSkipTLSVerify = false
        annotations = {
          "cert-manager.io/inject-ca-from" = "${local.namespace}/${module.cert.certificate_name}"
        }
      }

      ///////////////////////////////////////
      // Health checks
      ////////////////////////////////////////
      livenessProbe = {
        initialDelaySeconds = 20
        periodSeconds       = 10
        failureThreshold    = 3
      }
      readinessProbe = {
        initialDelaySeconds = 20
        periodSeconds       = 10
        failureThreshold    = 1
      }
    })
  ]
}

resource "kubectl_manifest" "pdb" {
  yaml_body = yamlencode({
    apiVersion = "policy/v1"
    kind       = "PodDisruptionBudget"
    metadata = {
      name      = local.name
      namespace = local.namespace
      labels    = module.util.labels
    }
    spec = {
      unhealthyPodEvictionPolicy = "AlwaysAllow"
      selector = {
        matchLabels = module.util.match_labels
      }
      maxUnavailable = 1
    }
  })
  server_side_apply = true
  force_conflicts   = true
  depends_on        = [helm_release.metrics_server]
}

resource "kubectl_manifest" "vpa" {
  count = var.vpa_enabled ? 1 : 0
  yaml_body = yamlencode({
    apiVersion = "autoscaling.k8s.io/v1"
    kind       = "VerticalPodAutoscaler"
    metadata = {
      name      = local.name
      namespace = local.namespace
      labels    = module.util.labels
    }
    spec = {
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
        name       = local.name
      }
    }
  })
  force_conflicts   = true
  server_side_apply = true
  depends_on        = [helm_release.metrics_server]
}
