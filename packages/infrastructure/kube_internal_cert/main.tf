terraform {
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "2.27.0"
    }
    kubectl = {
      source  = "alekc/kubectl"
      version = "2.0.4"
    }
  }
}

locals {
  localhost_sans = var.include_localhost ? ["localhost"] : []
}

module "util" {
  source = "../kube_workload_utility"

  # pf-generate: set_vars
  pf_stack_version = var.pf_stack_version
  pf_stack_commit  = var.pf_stack_commit
  environment      = var.environment
  region           = var.region
  pf_root_module   = var.pf_root_module
  pf_module        = var.pf_module
  is_local         = var.is_local
  extra_tags       = var.extra_tags
  # end-generate
}

resource "kubectl_manifest" "cert" {
  yaml_body = yamlencode({
    apiVersion = "cert-manager.io/v1"
    kind       = "Certificate"
    metadata = {
      name      = var.secret_name
      namespace = var.namespace
      labels    = module.util.labels
    }
    spec = {
      secretName = var.secret_name
      secretTemplate = {
        annotations = {
          // This allows for the secret to have its ca data directly injected into webhooks
          "cert-manager.io/allow-direct-injection" = "true"
        }
        labels = module.util.labels
      }
      commonName = var.common_name == null ? (length(var.service_names) == 0 ? "default" : "${var.service_names[0]}.${var.namespace}.svc") : var.common_name
      dnsNames = length(var.service_names) == 0 ? concat(["default"], local.localhost_sans) : concat(
        flatten([for service in var.service_names : [
          service,
          "${service}.${var.namespace}",
          "${service}.${var.namespace}.svc",
          "${service}.${var.namespace}.svc.cluster.local"
        ]]),
        !var.include_subdomains ? [] : flatten([for service in var.service_names : [
          "*.${service}",
          "*.${service}.${var.namespace}",
          "*.${service}.${var.namespace}.svc",
          "*.${service}.${var.namespace}.svc.cluster.local"
        ]]),
        local.localhost_sans
      )
      ipAddresses = var.include_localhost ? ["127.0.0.1"] : []
      subject = {
        organizations = length(var.service_names) == 0 ? ["default"] : var.service_names
      }
      usages = tolist(toset(concat([
        "key encipherment",
        "digital signature",
        "server auth",
        "client auth"
      ], var.is_ca ? ["cert sign", "crl sign"] : [], var.usages)))


      duration    = var.duration
      renewBefore = var.renew_before

      isCA = var.is_ca

      privateKey = {
        algorithm      = "ECDSA"
        size           = 256
        rotationPolicy = var.private_key_rotation_enabled ? "Always" : "Never"
        encoding       = var.private_key_encoding
      }

      issuerRef = {
        name  = var.issuer_name == null ? (var.is_ca ? "internal-ca" : "internal") : var.issuer_name
        kind  = var.use_cluster_issuer ? "ClusterIssuer" : "Issuer"
        group = "cert-manager.io"
      }
    }
  })

  force_conflicts   = true
  server_side_apply = true

  wait_for {
    field {
      key   = "status.conditions.[0].status"
      value = "True"
    }
  }
}

