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
    kubectl = {
      source  = "alekc/kubectl"
      version = "2.1.3"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
    pf = {
      source  = "panfactum/pf"
      version = "0.0.7"
    }
  }
}

locals {
  name      = "scheduler"
  namespace = module.namespace.namespace
}

data "pf_kube_labels" "labels" {
  module = "kube_scheduler"
}

module "constants" {
  source = "../kube_constants"
}

module "namespace" {
  source = "../kube_namespace"

  namespace = local.name
}

data "kubectl_server_version" "version" {}

/***************************************
* Scheduler
***************************************/


resource "kubernetes_cluster_role_binding" "scheduler" {
  metadata {
    name   = "panfactum-scheduler"
    labels = merge(module.scheduler.labels, data.pf_kube_labels.labels.labels)
  }
  subject {
    kind      = "ServiceAccount"
    name      = module.scheduler.service_account_name
    namespace = local.namespace
  }
  role_ref {
    name      = "system:kube-scheduler"
    kind      = "ClusterRole"
    api_group = "rbac.authorization.k8s.io"
  }
}

resource "kubernetes_cluster_role_binding" "volume_scheduler" {
  metadata {
    name   = "panfactum-volume-scheduler"
    labels = merge(module.scheduler.labels, data.pf_kube_labels.labels.labels)
  }
  subject {
    kind      = "ServiceAccount"
    name      = module.scheduler.service_account_name
    namespace = local.namespace
  }
  role_ref {
    name      = "system:volume-scheduler"
    kind      = "ClusterRole"
    api_group = "rbac.authorization.k8s.io"
  }
}

resource "kubernetes_role_binding" "scheduler_extension" {
  metadata {
    name      = "panfactum-scheduler-extension"
    labels    = merge(module.scheduler.labels, data.pf_kube_labels.labels.labels)
    namespace = "kube-system"
  }
  subject {
    kind      = "ServiceAccount"
    name      = module.scheduler.service_account_name
    namespace = local.namespace
  }
  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "Role"
    name      = "extension-apiserver-authentication-reader"
  }
}

resource "kubernetes_config_map" "scheduler" {
  metadata {
    name      = "scheduler"
    namespace = local.namespace
    labels    = merge(module.scheduler.labels, data.pf_kube_labels.labels.labels)
  }
  data = {
    "config.yaml" = yamlencode({
      apiVersion = "kubescheduler.config.k8s.io/v1"
      kind       = "KubeSchedulerConfiguration"
      profiles = [{
        schedulerName = "panfactum"
        plugins = {
          score = {
            enabled = [
              {
                name   = "NodeResourcesFit"
                weight = 2
              }
            ]
          }
        }
        pluginConfig = [
          {
            name = "NodeResourcesFit"
            args = {
              apiVersion = "kubescheduler.config.k8s.io/v1"
              kind       = "NodeResourcesFitArgs"
              scoringStrategy = {
                resources = [
                  { name = "cpu", weight = 1 },
                  { name = "memory", weight = 1 }
                ]
                type = "MostAllocated"
              }
            }
          }
        ]
      }]
      leaderElection = {
        leaderElect = false
      }
    })
  }
}

module "scheduler" {
  source    = "../kube_deployment"
  namespace = local.namespace
  name      = local.name

  replicas                             = var.sla_target >= 2 ? 2 : 1
  burstable_nodes_enabled              = var.burstable_nodes_enabled
  spot_nodes_enabled                   = var.spot_nodes_enabled
  controller_nodes_enabled             = var.controller_nodes_enabled
  controller_nodes_required            = var.sla_target >= 2 ? false : true
  instance_type_anti_affinity_required = var.sla_target == 3
  az_spread_preferred                  = var.sla_target >= 2
  host_anti_affinity_required          = var.sla_target >= 2
  priority_class_name                  = "system-cluster-critical" # Scheduling will break if this breaks
  panfactum_scheduler_enabled          = false                     # Cannot schedule itself
  pull_through_cache_enabled           = var.pull_through_cache_enabled

  # The scheduler is a dependency of linkerd so we should not enable linkerd for it in order to avoid
  # a deadlock. Additionally, this just communicates with the k8s API server which is not in the cluster
  # so the service mesh does not add any value.
  linkerd_enabled = false

  containers = [
    {
      name             = "scheduler"
      image_registry   = "registry.k8s.io"
      image_repository = "kube-scheduler"
      image_tag        = data.kubectl_server_version.version.version
      command = [
        "/usr/local/bin/kube-scheduler",
        "--config=/etc/kubernetes/scheduler/config.yaml",
        "-v=${var.log_verbosity}",
        "--leader-elect=${var.sla_target >= 2}",
        "--leader-elect-resource-namespace=scheduler"
      ]
      minimum_memory          = 75
      memory_limit_multiplier = 2.5 # Ensure this never gets stuck in OOM and crashes cluster
    }
  ]

  max_surge = var.sla_target >= 2 ? "0%" : "100%"

  config_map_mounts = {
    "${kubernetes_config_map.scheduler.metadata[0].name}" = {
      mount_path = "/etc/kubernetes/scheduler"
    }
  }

  vpa_enabled = var.vpa_enabled
}
