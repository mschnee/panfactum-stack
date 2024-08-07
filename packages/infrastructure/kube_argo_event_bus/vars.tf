variable "namespace" {
  description = "The namespace to deploy the EventBus into."
  type        = string
}

variable "vpa_enabled" {
  description = "Whether the VPA resources should be enabled"
  type        = bool
  default     = true
}

variable "log_level" {
  description = "The log level for the argo pods"
  type        = string
  default     = "info"
  validation {
    condition     = contains(["info", "error", "warn", "debug"], var.log_level)
    error_message = "Invalid log_level provided."
  }
}

variable "event_bus_storage_class_name" {
  description = "The storage class to use for the event bus"
  type        = string
  default     = "ebs-standard"
}

variable "event_bus_initial_volume_size" {
  description = "The initial volume size to use for each node in the event bus"
  type        = string
  default     = "1Gi"
}

variable "enhanced_ha_enabled" {
  description = "Whether to add extra high-availability scheduling constraints at the trade-off of increased cost"
  type        = bool
  default     = true
}
