variable "namespace" {
  description = "The namespace where the pod will run"
  type        = string
}

variable "containers" {
  description = "A list of container configurations for the pod"
  type = list(object({
    name                 = string
    init                 = optional(bool, false)
    image                = string
    version              = string
    command              = list(string)
    image_pull_policy    = optional(string, "IfNotPresent")
    working_dir          = optional(string, null)
    minimum_memory       = optional(number, 100)      # The minimum amount of memory in megabytes
    minimum_cpu          = optional(number, 10)       # The minimum amount of cpu millicores
    run_as_root          = optional(bool, false)      # Whether to run the container as root
    uid                  = optional(number, 1000)     # user to use when running the container if not root
    linux_capabilities   = optional(list(string), []) # Default is drop ALL
    readonly             = optional(bool, true)       # Whether to use a readonly file system
    env                  = optional(map(string), {})  # Environment variables specific to the container
    liveness_check_port  = optional(number, null)     # The number of the port for the liveness_check
    liveness_check_type  = optional(string, null)     # Either HTTP or TCP
    liveness_check_route = optional(string, null)     # The route if using HTTP liveness_checks
    ready_check_port     = optional(number, null)     # The number of the port for the ready_check (default to liveness_check_port)
    ready_check_type     = optional(string, null)     # Either HTTP or TCP (default to liveness_check_type)
    ready_check_route    = optional(string, null)     # The route if using HTTP ready_checks (default to liveness_check_route)
  }))
}

variable "restart_policy" {
  description = "The pod restart policy"
  type        = string
  default     = "Always"
}

variable "common_env" {
  description = "Key pair values of the environment variables for each container"
  type        = map(string)
  default     = {}
}

variable "pod_annotations" {
  description = "Annotations to add to the pods in the deployment"
  type        = map(string)
  default     = {}
}

variable "extra_pod_labels" {
  description = "Extra pod labels to use"
  type        = map(string)
  default     = {}
}

variable "service_account" {
  description = "The name of the service account to use for this deployment"
  type        = string
  default     = null
}

variable "tmp_directories" {
  description = "A list of paths that contain empty temporary directories"
  type = map(object({
    size_gb = optional(number, 1)
  }))
  default = {}
}

variable "config_map_mounts" {
  description = "A list ConfigMap names to their absolute mount paths in the containers of the deployment"
  type        = map(string)
  default     = {}
}

variable "secret_mounts" {
  description = "A mapping of Kubernetes secret names to their absolute mount paths in the containers of the deployment"
  type        = map(string)
  default     = {}
}


variable "mount_owner" {
  description = "The ID of the group that owns the mounted volumes"
  type        = number
  default     = 1000
}

variable "dynamic_secrets" {
  description = "Dynamic variable secrets"
  type = list(object({             // key is the secret provider class
    secret_provider_class = string // name of the secret provider class
    mount_path            = string // absolute path of where to mount the secret
    env_var               = string // name of the env var that will have a path to the secret mount
  }))
  default = []
}

variable "node_preferences" {
  description = "Node label preferences for the pod"
  type        = map(object({ weight = number, operator = string, values = list(string) }))
  default     = {}
}

variable "node_requirements" {
  description = "Node label requirements for the pod"
  type        = map(list(string))
  default     = {}
}

variable "secrets" {
  description = "Key pair values of secrets to add to the containers as environment variables"
  type        = map(string)
  default     = {}
}

variable "tolerations" {
  description = "A list of tolerations for the pods"
  type = list(object({
    key      = string
    operator = string
    value    = string
    effect   = string
  }))
  default = []
}

variable "priority_class_name" {
  description = "The priority class to use for pods in the deployment"
  type        = string
  default     = null
}

variable "dns_policy" {
  description = "The DNS policy for the pod"
  type        = string
  default     = "ClusterFirst"
}

variable "spot_instances_enabled" {
  description = "Whether the pods can be scheduled on spot instances"
  type        = bool
  default     = false
}

variable "burstable_instances_enabled" {
  description = "Whether the pods can be scheduled on burstable instances"
  type        = bool
  default     = false
}

variable "pod_anti_affinity_type" {
  description = "The podAntiAffinity to use for the pods. 'none' for no anti-affinity. `instance_type` for only one of each pod per instance type. 'node' for only one of each pod per node."
  type        = string
  default     = "none"
  validation {
    condition     = contains(["none", "instance_type", "node"], var.pod_anti_affinity_type)
    error_message = "Invalid pod_anti_affinity_type"
  }
}
