variable "namespace" {
  description = "The namespace to deploy the EventBus into."
  type        = string
}

variable "vpa_enabled" {
  description = "Whether the VPA resources should be enabled"
  type        = bool
  default     = true
}

variable "pull_through_cache_enabled" {
  description = "Whether to use the ECR pull through cache for the deployed images"
  type        = bool
  default     = false
}

variable "helm_version" {
  description = "The version of the bitnami/nats helm chart to use"
  type        = string
  default     = "8.5.1"
}

variable "spot_nodes_enabled" {
  description = "Whether the database pods can be scheduled on spot nodes"
  type        = bool
  default     = true
}

variable "burstable_nodes_enabled" {
  description = "Whether the database pods can be scheduled on burstable nodes"
  type        = bool
  default     = true
}

variable "arm_nodes_enabled" {
  description = "Whether the database pods can be scheduled on arm64 nodes"
  type        = bool
  default     = true
}

variable "controller_nodes_enabled" {
  description = "Whether to allow pods to schedule on EKS Node Group nodes (controller nodes)"
  type        = bool
  default     = true
}

variable "minimum_memory_mb" {
  description = "The minimum memory in MB to use for the NATS nodes"
  type        = number
  default     = 100

  validation {
    condition     = var.minimum_memory_mb >= 100
    error_message = "Must specify at least 100Mb of memory"
  }
}

variable "monitoring_enabled" {
  description = "Whether to allow monitoring CRs to be deployed in the namespace"
  type        = bool
  default     = false
}

variable "panfactum_scheduler_enabled" {
  description = "Whether to use the Panfactum pod scheduler with enhanced bin-packing"
  type        = bool
  default     = true
}

variable "instance_type_anti_affinity_required" {
  description = "Whether to enable anti-affinity to prevent pods from being scheduled on the same instance type. Defaults to true iff sla_target >= 2."
  type        = bool
  default     = null
}

variable "vault_credential_lifetime_hours" {
  description = "The lifetime of database credentials generated by Vault"
  type        = number
  default     = 16

  validation {
    condition     = var.vault_credential_lifetime_hours >= 2
    error_message = "vault_credential_lifetime_hours must be at least 2"
  }
}

variable "node_image_cached_enabled" {
  description = "Whether to add the container images to the node image cache for faster startup times"
  type        = bool
  default     = true
}

variable "persistence_initial_storage_gb" {
  description = "How many GB to initially allocate for persistent storage (will grow automatically as needed). Can only be set on cluster creation."
  type        = number
  default     = 1
}

variable "persistence_storage_limit_gb" {
  description = "The maximum number of gigabytes of storage to provision for each NATS node"
  type        = number
  default     = null
}

variable "persistence_storage_increase_threshold_percent" {
  description = "Dropping below this percent of free storage will trigger an automatic increase in storage size"
  type        = number
  default     = 20
}

variable "persistence_storage_increase_gb" {
  description = "The amount of GB to increase storage by if free space drops below the threshold"
  type        = number
  default     = 1
}

variable "persistence_storage_class_name" {
  description = "The StorageClass to use for the PVs used to store filesystem data. Can only be set on cluster creation."
  type        = string
  default     = "ebs-standard-retained"
}

variable "persistence_backups_enabled" {
  description = "Whether to enable backups of the NATS durable storage."
  type        = bool
  default     = true
}

variable "voluntary_disruptions_enabled" {
  description = "Whether to enable voluntary disruptions of pods in this module."
  type        = bool
  default     = true
}

variable "voluntary_disruption_window_enabled" {
  description = "Whether to confine voluntary disruptions of pods in this module to specific time windows"
  type        = bool
  default     = false
}

variable "voluntary_disruption_window_seconds" {
  description = "The length of the disruption window in seconds"
  type        = number
  default     = 3600
  validation {
    condition     = var.voluntary_disruption_window_seconds >= 900
    error_message = "The disruption window must be at least 15 minutes to be effective."
  }
}

variable "voluntary_disruption_window_cron_schedule" {
  description = "The times when disruption windows should start"
  type        = string
  default     = "0 4 * * *"
}

variable "max_connections" {
  description = "The maximum number of client connections to the NATS cluster"
  type        = number
  default     = 64000
}

variable "max_control_line_kb" {
  description = "The maximum length of a protocol line including combined length of subject and queue group (in KB)."
  type        = number
  default     = 4
}

variable "max_payload_mb" {
  description = "The maximum size of a message payload (in MB)."
  type        = number
  default     = 8
}

variable "write_deadline_seconds" {
  description = "The maximum number of seconds the server will block when writing messages to consumers."
  type        = number
  default     = 55
}

variable "ping_interval_seconds" {
  description = "Interval in seconds at which pings are sent to clients, leaf nodes, and routes."
  type        = number
  default     = 20

  validation {
    condition     = var.ping_interval_seconds >= 10
    error_message = "ping_interval_seconds should not be less than 10 seconds as this will result in unnecessary cluster traffic"
  }

  validation {
    condition     = var.ping_interval_seconds <= 30
    error_message = "ping_interval_seconds should be less than 30 seconds to ensure cluster statbility."
  }
}

variable "fsync_interval_seconds" {
  description = "Interval in seconds at which data will be synced to disk on each node. Setting this to 0 will force an fsync after each message (which will lower overall throughput dramatically)."
  type        = number
  default     = 10

  validation {
    condition     = var.fsync_interval_seconds >= 0
    error_message = "fsync_interval_seconds must be greater than or equal to 0."
  }

  validation {
    condition     = var.fsync_interval_seconds <= 60 * 10
    error_message = "fsync_interval_seconds must be less than 10 minutes (600 seconds) to ensure cluster stability."
  }
}

variable "max_outstanding_catchup_mb" {
  description = "The maximum in-flight bytes for stream catch-up."
  type        = number
  default     = 128

  validation {
    condition     = var.max_outstanding_catchup_mb >= 128
    error_message = "max_outstanding_catchup_mb must be at least 128 to ensure cluster stability during network disruptions."
  }
}

variable "log_level" {
  description = "The log level for the NATS pods. Must be one of: info, debug, trace"
  type        = string
  default     = "info"

  validation {
    condition     = contains(["info", "debug", "trace"], var.log_level)
    error_message = "log_level must be one of: info, debug, trace"
  }
}

variable "cert_manager_namespace" {
  description = "The namespace where cert-manager is deployed."
  type        = string
  default     = "cert-manager"
}

variable "vault_internal_url" {
  description = "The internal URL of the Vault cluster."
  type        = string
  default     = "http://vault-active.vault.svc.cluster.local:8200"
}

variable "vault_internal_pki_backend_mount_path" {
  description = "The mount path of the PKI backend for internal certificates."
  type        = string
  default     = "pki/internal"
}