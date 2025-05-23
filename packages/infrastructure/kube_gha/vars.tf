variable "gha_runner_scale_set_controller_helm_version" {
  description = "The version of the actions-runner-controller-charts/gha-runner-scale-set-controller helm chart to deploy"
  type        = string
  default     = "0.9.3"
}

variable "vpa_enabled" {
  description = "Whether the VPA resources should be enabled"
  type        = bool
  default     = true
}

variable "panfactum_scheduler_enabled" {
  description = "Whether to use the Panfactum pod scheduler with enhanced bin-packing"
  type        = bool
  default     = true
}

variable "pull_through_cache_enabled" {
  description = "Whether to use the ECR pull through cache for the deployed images"
  type        = bool
  default     = true
}

variable "log_level" {
  description = "The log level to use for the pods"
  type        = string
  default     = "warn"
  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level must be one of: debug, info, warn, error"
  }
}

variable "wait" {
  description = "Wait for resources to be in a ready state before proceeding. Disabling this flag will allow upgrades to proceed faster but will disable automatic rollbacks. As a result, manual intervention may be required for deployment failures."
  type        = bool
  default     = true
}

variable "spot_nodes_enabled" {
  description = "Whether to allow pods to schedule on spot nodes"
  type        = bool
  default     = true
}

variable "burstable_nodes_enabled" {
  description = "Whether to allow pods to schedule on burstable nodes"
  type        = bool
  default     = true
}

variable "controller_nodes_enabled" {
  description = "Whether to allow pods to schedule on EKS Node Group nodes (controller nodes)"
  type        = bool
  default     = true
}