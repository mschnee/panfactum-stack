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
    helm = {
      source  = "hashicorp/helm"
      version = "2.12.1"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "5.39.1"
    }
  }
}

locals {
  name      = "vertical-pod-autoscaler"
  namespace = module.namespace.namespace
}

module "pull_through" {
  count  = var.pull_through_cache_enabled ? 1 : 0
  source = "../aws_ecr_pull_through_cache_addresses"
}

module "kube_labels" {
  source = "../kube_labels"

  # generate: common_vars.snippet.txt
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

module "constants_admission_controller" {
  source = "../constants"

  matching_labels = {
    "app.kubernetes.io/name"      = "vpa"
    "app.kubernetes.io/component" = "admission-controller"
  }

  # generate: common_vars.snippet.txt
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

module "constants_updater" {
  source = "../constants"

  matching_labels = {
    "app.kubernetes.io/name"      = "vpa"
    "app.kubernetes.io/component" = "updater"
  }

  # generate: common_vars.snippet.txt
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

module "constants_recommender" {
  source = "../constants"

  matching_labels = {
    "app.kubernetes.io/name"      = "vpa"
    "app.kubernetes.io/component" = "recommender"
  }

  # generate: common_vars.snippet.txt
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

# ################################################################################
# Namespace
# ################################################################################

module "namespace" {
  source = "../kube_namespace"

  namespace = local.name

  # generate: pass_common_vars.snippet.txt
  pf_stack_version = var.pf_stack_version
  pf_stack_commit  = var.pf_stack_commit
  environment      = var.environment
  region           = var.region
  pf_root_module   = var.pf_root_module
  is_local         = var.is_local
  extra_tags       = var.extra_tags
  # end-generate
}

# ################################################################################
# Vertical Autoscaler
# ################################################################################

module "webhook_cert" {
  source = "../kube_internal_cert"

  service_names = ["vpa-webhook"]
  secret_name   = "vpa-webhook-certs"
  namespace     = local.namespace

  # generate: pass_common_vars.snippet.txt
  pf_stack_version = var.pf_stack_version
  pf_stack_commit  = var.pf_stack_commit
  environment      = var.environment
  region           = var.region
  pf_root_module   = var.pf_root_module
  is_local         = var.is_local
  extra_tags       = var.extra_tags
  # end-generate
}

resource "helm_release" "vpa" {
  namespace       = local.namespace
  name            = local.name
  repository      = "https://charts.fairwinds.com/stable"
  chart           = "vpa"
  version         = var.vertical_autoscaler_helm_version
  recreate_pods   = false
  cleanup_on_fail = true
  wait            = true
  wait_for_jobs   = true

  values = [
    yamlencode({
      fullnameOverride = "vpa"

      podLabels = merge(module.kube_labels.kube_labels, {
        customizationHash = md5(join("", [for filename in fileset(path.module, "vpa_kustomize/*") : filesha256(filename)]))
      })

      priorityClassName = "system-cluster-critical"

      recommender = {

        image = {
          repository = "${var.pull_through_cache_enabled ? module.pull_through[0].kubernetes_registry : "registry.k8s.io"}/autoscaling/vpa-recommender"
          tag        = var.vertical_autoscaler_image_version
        }

        podAnnotations = {
          "config.alpha.linkerd.io/proxy-enable-native-sidecar" = "true"
        }

        // ONLY 1 of these should be running at a time
        // b/c there is no leader-election: https://github.com/kubernetes/autoscaler/issues/5481
        // However, that creates a potential issue with memory consumption as if this pod
        // OOMs, then it won't be recorded and then bumped up. As a result, we have to tune this
        // pods memory floor carefully and give it plenty of headroom.
        replicaCount = 1
        affinity     = module.constants_recommender.controller_node_with_burstable_affinity_helm
        tolerations  = module.constants_recommender.burstable_node_toleration_helm

        metrics = {
          serviceMonitor = {
            enabled   = var.monitoring_enabled
            namespace = local.namespace
            interval  = "60s"
            timeout   = "10s"
          }
        }

        extraArgs = merge({
          // Better packing
          "pod-recommendation-min-cpu-millicores" = 2
          "pod-recommendation-min-memory-mb"      = 10

          // After 8 halvings, the metrics will essentially be ignored
          "cpu-histogram-decay-half-life"    = "${max(1, floor(var.history_length_hours / 8))}h0m0s"
          "memory-histogram-decay-half-life" = "${max(1, floor(var.history_length_hours / 8))}h0m0s"

          // Provide 30% headroom (instead of the 15% default)
          "recommendation-margin-fraction" = 0.3

          v = var.log_verbosity
          }, var.prometheus_enabled ? {
          // When prometheus is enabled, the initial recommendations will be
          // provided by prometheus queries instead of the VPACheckpoint objects
          //
          // CPU: rate(container_cpu_usage_seconds_total{job="kubelet", pod=~".+", container!="POD", container!=""}[<history-resolution>])
          // MEMORY: container_memory_working_set_bytes{job="kubelet", pod=~".+", container!="POD", container!=""}
          //
          // Those queries will look back <history-length> time at <history-resolution> steps in order to provide
          // initial data for the internal histogram buckets.
          //
          // In order to match the metrics with actual VPA resources, pod labels are used which are provided
          // by kube-state-metrics via kube_pod_labels{}[<history-length>. This must go back all the way to the <history-length> (lots of data!)
          // Pods not found in kube_pod_labels{} will be dropped from the assessments.
          //
          // After loading this initial metrics, the recommender will no longer query prometheus and instead
          // rely on live monitoring of the kubernetes API for updating its internal recommendations
          //
          // Using Prometheus has the following weaknesses:
          // - Prometheus and kube-state-metrics need to be running for at least <history-length> in order for the VPA
          // to provide accurate recommendations. BEWARE: Ignoring this recommendation will likely cause some of your
          // VPAs to not work at all due to the way that the recommender drops AggregateCollectionStates for VPA targets
          // that have no historical data. This will likely cause a cascading failure in your system!!!
          //
          // - Because prometheus focused on pods, time periods with more pods (high churn / more replicas) will have
          // more samples added to the histogram bucket and thus be weighted more heavily
          //
          // - As this only runs at recommender startup, this will cause a significant resource burst (on both prometheus and the recommender),
          // which may cause system components to crash if not planned for in advance. As a result, <history-length> should be kept reasonable.
          //
          // - OOMs are not tracked in the metrics history so will essentially be forgotten every time the recommender restarts
          prometheus-address           = var.thanos_query_frontend_url
          storage                      = "prometheus"
          prometheus-cadvisor-job-name = "kubelet"
          container-pod-name-label     = "pod"
          container-name-label         = "container"
          container-namespace-label    = "namespace"
          pod-namespace-label          = "namespace"
          pod-name-label               = "pod"
          metric-for-pod-labels        = "kube_pod_labels{}[${var.history_length_hours}h]" #
          pod-label-prefix             = "label_"
          history-length               = "${var.history_length_hours}h"
          history-resolution           = "${max(floor(var.history_length_hours * 60 / 100), 1)}m" # Gets the last 100 samples
        } : {})

        resources = {
          requests = {
            memory = "300Mi"
          }
          limits = {
            memory = "500Mi"
          }
        }
      }


      updater = {

        image = {
          repository = "${var.pull_through_cache_enabled ? module.pull_through[0].kubernetes_registry : "registry.k8s.io"}/autoscaling/vpa-updater"
          tag        = var.vertical_autoscaler_image_version
        }

        podAnnotations = {
          "config.alpha.linkerd.io/proxy-enable-native-sidecar" = "true"
        }

        // ONLY 1 of these should be running at a time
        // b/c there is no leader-election: https://github.com/kubernetes/autoscaler/issues/5481
        replicaCount = 1
        affinity     = module.constants_updater.controller_node_with_burstable_affinity_helm
        tolerations  = module.constants_updater.burstable_node_toleration_helm

        metrics = {
          serviceMonitor = {
            enabled   = var.monitoring_enabled
            namespace = local.namespace
            interval  = "60s"
            timeout   = "10s"
          }
        }

        extraArgs = {
          "min-replicas" = 0 // We don't care b/c we use pdbs
          v              = var.log_verbosity
        }

        resources = {
          requests = {
            memory = "100Mi"
          }
          limits = {
            memory = "130Mi"
          }
        }
      }

      admissionController = {

        image = {
          repository = "${var.pull_through_cache_enabled ? module.pull_through[0].kubernetes_registry : "registry.k8s.io"}/autoscaling/vpa-admission-controller"
          tag        = var.vertical_autoscaler_image_version
        }

        annotations = {
          "reloader.stakater.com/auto" = "true"
        }
        podAnnotations = {
          "config.alpha.linkerd.io/proxy-enable-native-sidecar" = "true"
        }

        // We do need at least 2 otherwise we may get stuck in a loop
        // b/c if this pod goes down, it cannot apply the appropriate
        // resource requirements when it comes back up and then the
        // updater will take it down again
        replicaCount = 2
        affinity = merge(
          module.constants_admission_controller.controller_node_with_burstable_affinity_helm,
          module.constants_admission_controller.pod_anti_affinity_preferred_instance_type_helm
        )
        tolerations = module.constants_admission_controller.burstable_node_toleration_helm

        metrics = {
          serviceMonitor = {
            enabled   = var.monitoring_enabled
            namespace = local.namespace
            interval  = "60s"
            timeout   = "10s"
          }
        }

        podDisruptionBudget = {
          minAvailable = 1
        }

        resources = {
          requests = {
            memory = "100Mi"
          }
          limits = {
            memory = "130Mi"
          }
        }

        // We will use our own secret
        generateCertificate = false
        secretName          = module.webhook_cert.secret_name
        extraArgs = {
          client-ca-file  = "/etc/tls-certs/ca.crt"
          tls-cert-file   = "/etc/tls-certs/tls.crt"
          tls-private-key = "/etc/tls-certs/tls.key"
          v               = var.log_verbosity
        }
        mutatingWebhookConfiguration = {
          annotations = {
            "cert-manager.io/inject-ca-from" = "${local.namespace}/${module.webhook_cert.certificate_name}"
          }
        }
      }
    })
  ]
}

resource "kubernetes_config_map" "dashboard" {
  count = var.monitoring_enabled ? 1 : 0
  metadata {
    name   = "vpa-dashboard"
    labels = merge(module.kube_labels.kube_labels, { "grafana_dashboard" = "1" })
  }
  data = {
    "vpa.json" = file("${path.module}/dashboard.json")
  }
}

/***************************************
* VPA Resources
***************************************/

resource "kubernetes_manifest" "vpa_controller" {
  count = var.vpa_enabled ? 1 : 0
  manifest = {
    apiVersion = "autoscaling.k8s.io/v1"
    kind       = "VerticalPodAutoscaler"
    metadata = {
      name      = "vpa-admission-controller"
      namespace = local.namespace
      labels    = module.kube_labels.kube_labels
    }
    spec = {
      targetRef = {
        apiVersion = "apps/v1"
        kind       = "Deployment"
        name       = "vpa-admission-controller"
      }
    }
  }
}

resource "kubernetes_manifest" "vpa_recommender" {
  count = var.vpa_enabled ? 1 : 0
  manifest = {
    apiVersion = "autoscaling.k8s.io/v1"
    kind       = "VerticalPodAutoscaler"
    metadata = {
      name      = "vpa-recommender"
      namespace = local.namespace
      labels    = module.kube_labels.kube_labels
    }
    spec = {
      resourcePolicy = {
        containerPolicies = [{
          containerName = "vpa"
          minAllowed = {
            memory = "100Mi"
          }
        }]
      }
      targetRef = {
        apiVersion = "apps/v1"
        kind       = "Deployment"
        name       = "vpa-recommender"
      }
    }
  }
}

resource "kubernetes_manifest" "vpa_updater" {
  count = var.vpa_enabled ? 1 : 0
  manifest = {
    apiVersion = "autoscaling.k8s.io/v1"
    kind       = "VerticalPodAutoscaler"
    metadata = {
      name      = "vpa-updater"
      namespace = local.namespace
      labels    = module.kube_labels.kube_labels
    }
    spec = {
      targetRef = {
        apiVersion = "apps/v1"
        kind       = "Deployment"
        name       = "vpa-updater"
      }
    }
  }
}
