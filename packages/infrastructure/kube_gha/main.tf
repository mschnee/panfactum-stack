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
  name      = "gha"
  namespace = module.namespace.namespace
}

data "pf_kube_labels" "labels" {
  module = "kube_gha"
}

module "constants" {
  source = "../kube_constants"
}

module "util" {
  source = "../kube_workload_utility"

  workload_name                        = "gha-scale-set-controller"
  burstable_nodes_enabled              = var.burstable_nodes_enabled
  controller_nodes_enabled             = var.controller_nodes_enabled
  spot_nodes_enabled                   = var.spot_nodes_enabled
  panfactum_scheduler_enabled          = var.panfactum_scheduler_enabled
  pull_through_cache_enabled           = var.pull_through_cache_enabled
  instance_type_anti_affinity_required = false
  az_spread_preferred                  = false
  extra_labels                         = data.pf_kube_labels.labels.labels
}

/***************************************
* Namespace
***************************************/

module "namespace" {
  source = "../kube_namespace"

  namespace = local.name
}

/***************************************
* Controller
***************************************/

resource "kubernetes_service_account" "gha_controller" {
  metadata {
    name      = "gha-scale-set-controller"
    namespace = local.namespace
    labels    = module.util.labels
  }
}

resource "helm_release" "gha_controller" {
  namespace       = local.namespace
  name            = "gha-runner-scale-set-controller"
  repository      = "oci://ghcr.io/actions/actions-runner-controller-charts/"
  chart           = "gha-runner-scale-set-controller"
  version         = var.gha_runner_scale_set_controller_helm_version
  recreate_pods   = false
  atomic          = var.wait
  cleanup_on_fail = var.wait
  wait            = var.wait
  wait_for_jobs   = true
  force_update    = true
  max_history     = 5

  values = [
    yamlencode({
      fullnameOverride = "gha-controller"
      replicaCount     = 1
      labels           = module.util.labels
      podLabels        = module.util.labels

      serviceAccount = {
        create = false
        name   = kubernetes_service_account.gha_controller.metadata[0].name
      }

      securityContext = {
        capabilities             = { drop = ["ALL"] }
        readOnlyRootFilesystem   = true
        runAsNonRoot             = true
        runAsUser                = 1000
        allowPrivilegeEscalation = false
      }

      priorityClassName = module.constants.cluster_important_priority_class_name

      tolerations = module.util.tolerations
      affinity    = module.util.affinity

      flags = {
        logLevel             = var.log_level
        logFormat            = "json"
        watchSingleNamespace = local.namespace
      }

      metrics = {
        controllerManagerAddr = ":8080"
        listenerAddr          = ":8080"
        listenerEndpoint      = "/metrics"
      }
    })
  ]
}

resource "kubectl_manifest" "vpa" {
  count = var.vpa_enabled ? 1 : 0
  yaml_body = yamlencode({
    apiVersion = "autoscaling.k8s.io/v1"
    kind       = "VerticalPodAutoscaler"
    metadata = {
      name      = "gha-controller"
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
        name       = "gha-controller"
      }
    }
  })
  depends_on = [helm_release.gha_controller]
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
      selector = {
        matchLabels = module.util.match_labels
      }
      maxUnavailable             = 1
      unhealthyPodEvictionPolicy = "AlwaysAllow"
    }
  })
  force_conflicts   = true
  server_side_apply = true
  depends_on        = [helm_release.gha_controller]
}



