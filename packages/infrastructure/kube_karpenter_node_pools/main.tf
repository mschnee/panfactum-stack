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
    aws = {
      source  = "hashicorp/aws"
      version = "5.80.0"
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
  cluster_name = data.pf_metadata.metadata.kube_cluster_name
  name         = "karpenter"
  version      = 2

  // (1) <2GB of memory is not efficient as each node requires about 1GB of memory just for the
  // base kubernetes utilities and controllers that must run on each node
  // (2) If monitoring has been deployed, this gets even worse as we have monitoring systems
  // deployed on each node. As a result, increase the minimum node size even further to improve
  // efficiency
  min_instance_memory = var.min_node_memory_mb

  // Explicitly listing allows us to expand
  // the number of instance families allowed in each node pool
  // which improves overall cluster efficiency
  base_instance_families = [
    "m8g",
    "m7g",
    "m7i",
    "m7a",
    "m6g",
    "m6i",
    "m6a",
    "c8g",
    "c7g",
    "c7i",
    "c7a",
    "c6g",
    "c6gn",
    "c6i",
    "c6a",
    "r8g",
    "r7g",
    "r7i",
    "r7iz",
    "r7a",
    "r6g",
    "r6i",
    "r6a"
  ]

  // Blacklisted sizes
  // These sizes are not allowed as bare metals instances are incompatible
  // with our base AMI
  blacklisted_sizes = [
    "metal",
    "metal-16xl",
    "metal-24xl",
    "metal-48xl"
  ]

  shared_requirements = [
    {
      key      = "karpenter.k8s.aws/instance-cpu"
      operator = "Lt"
      values   = [tostring(var.max_node_cpu + 1)]
    },
    {
      key      = "karpenter.k8s.aws/instance-cpu"
      operator = "Gt"
      values   = [tostring(var.min_node_cpu)]
    },
    {
      key      = "karpenter.k8s.aws/instance-memory"
      operator = "Lt"
      values   = [tostring(var.max_node_memory_mb + 1)]
    },
    {
      key      = "karpenter.k8s.aws/instance-memory"
      operator = "Gt"
      values   = [tostring(local.min_instance_memory)]
    },
    {
      key      = "kubernetes.io/os"
      operator = "In"
      values   = ["linux"]
    },
    {
      key      = "karpenter.k8s.aws/instance-size"
      operator = "NotIn"
      values   = local.blacklisted_sizes
    }
  ]

  non_burstable_requirements = concat(
    local.shared_requirements,
    [
      {
        key      = "karpenter.k8s.aws/instance-family"
        operator = "In"
        values   = local.base_instance_families
      }
    ]
  )

  burstable_requirements = concat(
    local.shared_requirements,
    [
      {
        key      = "karpenter.k8s.aws/instance-family"
        operator = "In"
        values = concat(
          local.base_instance_families,
          [
            "t4g",
            "t3",
            "t3a",
            "c7i-flex",
            "m7i-flex"
          ]
        )
      }
    ]
  )

  any_capacity_type_requirements = [{
    key = "karpenter.sh/capacity-type"
    operator : "In"
    values : ["spot", "on-demand"]
  }]

  on_demand_capacity_type_requirements = [{
    key = "karpenter.sh/capacity-type"
    operator : "In"
    values : ["on-demand"]
  }]
  amd64_requirements = [{
    key      = "kubernetes.io/arch"
    operator = "In"
    values   = ["amd64"]
  }]

  any_arch_requirements = [{
    key      = "kubernetes.io/arch"
    operator = "In"
    values   = ["amd64", "arm64"]
  }]

  spot_taints = [
    {
      key    = "spot"
      value  = "true"
      effect = "NoSchedule"
    }
  ]

  burstable_taints = concat(
    local.spot_taints,
    [
      {
        key    = "burstable"
        value  = "true"
        effect = "NoSchedule"
      }
    ]
  )

  arm_taints = [
    {
      key    = "arm64"
      value  = "true"
      effect = "NoSchedule"
    }
  ]

  workflow_taints = [
    {
      key    = "workflow"
      value  = "true"
      effect = "NoSchedule"
    }
  ]

  startup_taints = [
    module.constants.cilium_taint,
    module.constants.linkerd_taint
  ]

  disruption_policy = {
    consolidationPolicy = "WhenEmptyOrUnderutilized"
    consolidateAfter    = "10s"
    budgets             = []
  }

  expire_after = "24h"

  node_class_template = {
    amiFamily                  = "Bottlerocket"
    subnetSelectorTerms        = [for subnet in data.aws_subnet.node_subnets : { id = subnet.id }]
    securityGroupSelectorTerms = [{ id = var.node_security_group_id }]
    instanceProfile            = var.node_instance_profile
    amiSelectorTerms = [
      {
        id = data.aws_ami.arm64_ami.id
      },
      {
        id = data.aws_ami.amd64_ami.id
      }
    ]

    metadataOptions = {
      httpEndpoint            = "enabled"
      httpProtocolIPv6        = "disabled"
      httpPutResponseHopLimit = 1 // don't allow pods to access the node roles
      httpTokens              = "required"
    }
    userData = module.node_settings.user_data
    blockDeviceMappings = [
      {
        deviceName = "/dev/xvda"
        ebs = {
          volumeSize          = "25Gi" // includes temp storage
          encrypted           = true
          deleteOnTermination = true
          volumeType          = "gp3"
        }
      },
      {
        deviceName = "/dev/xvdb"
        ebs = {
          volumeSize          = "${var.node_ebs_volume_size_gb}Gi"
          encrypted           = true
          deleteOnTermination = true
          volumeType          = "gp3"
        }
      }
    ]
    # For some reason some settings have to be set in the NodeClass
    # configuration in order to take effect
    kubelet = {
      maxPods = 110
    }
  }

  node_labels = merge(var.node_labels)

  burstable_node_labels = {
    "panfactum.com/class" = "burstable"
  }

  spot_node_labels = {
    "panfactum.com/class" = "spot"
  }

  worker_node_labels = {
    "panfactum.com/class" = "worker"
  }

  workflow_node_labels = {
    "panfactum.com/workflow-only" = "true"
  }

  burstable_node_class_ref = {
    group = "karpenter.k8s.aws"
    kind  = "EC2NodeClass"
    name  = kubectl_manifest.burstable_node_class.name
  }

  spot_node_class_ref = {
    group = "karpenter.k8s.aws"
    kind  = "EC2NodeClass"
    name  = kubectl_manifest.spot_node_class.name
  }

  worker_node_class_ref = {
    group = "karpenter.k8s.aws"
    kind  = "EC2NodeClass"
    name  = kubectl_manifest.default_node_class.name
  }

  spot_grace_period      = "2m0s"
  on_demand_grace_period = "1h0m0s"
}

data "pf_kube_labels" "labels" {
  module = "kube_karpenter_node_pools"
}

data "pf_metadata" "metadata" {}

module "constants" {
  source = "../kube_constants"
}

module "node_settings_burstable" {
  source = "../kube_node_settings"

  cluster_name           = local.cluster_name
  cluster_endpoint       = var.cluster_endpoint
  cluster_dns_service_ip = var.cluster_dns_service_ip
  is_spot                = true
}

module "node_settings_spot" {
  source = "../kube_node_settings"

  cluster_name           = local.cluster_name
  cluster_endpoint       = var.cluster_endpoint
  cluster_dns_service_ip = var.cluster_dns_service_ip
  cluster_ca_data        = var.cluster_ca_data
  is_spot                = true
}

module "node_settings" {
  source = "../kube_node_settings"

  cluster_name           = local.cluster_name
  cluster_endpoint       = var.cluster_endpoint
  cluster_dns_service_ip = var.cluster_dns_service_ip
  cluster_ca_data        = var.cluster_ca_data
  is_spot                = false
}

data "aws_subnet" "node_subnets" {
  for_each = var.node_subnets
  vpc_id   = var.node_vpc_id
  filter {
    name   = "tag:Name"
    values = [each.value]
  }
}

// This is purposefully pinned as AWS is known to publish AMI updates that break clusters
data "aws_ami" "arm64_ami" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = [var.arm64_node_ami_name]
  }
  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

data "aws_ami" "amd64_ami" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = [var.amd64_node_ami_name]
  }
  filter {
    name   = "root-device-type"
    values = ["ebs"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}


/********************************************************************************************************************
* Node Class
*********************************************************************************************************************/

resource "random_id" "default_node_class_name" {
  byte_length = 4
  prefix      = "default-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "default_node_class" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.k8s.aws/v1"
    kind       = "EC2NodeClass"
    metadata = {
      name   = random_id.default_node_class_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = local.node_class_template
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "random_id" "spot_node_class_name" {
  byte_length = 4
  prefix      = "spot-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "spot_node_class" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.k8s.aws/v1"
    kind       = "EC2NodeClass"
    metadata = {
      name   = random_id.spot_node_class_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = merge(
      local.node_class_template,
      {
        userData = module.node_settings_spot.user_data
      }
    )
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "random_id" "burstable_node_class_name" {
  byte_length = 4
  prefix      = "burstable-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "burstable_node_class" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.k8s.aws/v1"
    kind       = "EC2NodeClass"
    metadata = {
      name   = random_id.burstable_node_class_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = merge(
      local.node_class_template,
      {
        userData = module.node_settings_burstable.user_data
      }
    )
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}


/********************************************************************************************************************
* Node Pools
*********************************************************************************************************************/

resource "random_id" "burstable_node_pool_name" {
  byte_length = 4
  prefix      = "burstable-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "burstable_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = random_id.burstable_node_pool_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(local.node_labels, local.burstable_node_labels)
        }
        spec = {
          nodeClassRef  = local.burstable_node_class_ref
          taints        = local.burstable_taints
          startupTaints = local.startup_taints
          requirements = concat(
            local.burstable_requirements,
            local.any_capacity_type_requirements,
            local.amd64_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 25
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "kubectl_manifest" "wf_burstable_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = "wf-${random_id.burstable_node_pool_name.hex}"
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(
            local.node_labels,
            local.burstable_node_labels,
            local.workflow_node_labels
          )
        }
        spec = {
          nodeClassRef  = local.burstable_node_class_ref
          taints        = concat(local.burstable_taints, local.workflow_taints)
          startupTaints = local.startup_taints
          requirements = concat(
            local.burstable_requirements,
            local.any_capacity_type_requirements,
            local.amd64_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 25
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "random_id" "burstable_arm_node_pool_name" {
  byte_length = 4
  prefix      = "burstable-arm-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "kubectl_manifest" "burstable_arm_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = random_id.burstable_arm_node_pool_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(local.node_labels, local.burstable_node_labels)
        }
        spec = {
          nodeClassRef = local.burstable_node_class_ref
          taints = concat(
            local.burstable_taints,
            local.arm_taints
          )
          startupTaints = local.startup_taints
          requirements = concat(
            local.burstable_requirements,
            local.any_capacity_type_requirements,
            local.any_arch_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 30
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "kubectl_manifest" "wf_burstable_arm_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = "wf-${random_id.burstable_arm_node_pool_name.hex}"
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(
            local.node_labels,
            local.burstable_node_labels,
            local.workflow_node_labels
          )
        }
        spec = {
          nodeClassRef = local.burstable_node_class_ref
          taints = concat(
            local.burstable_taints,
            local.arm_taints,
            local.workflow_taints
          )
          startupTaints = local.startup_taints
          requirements = concat(
            local.burstable_requirements,
            local.any_capacity_type_requirements,
            local.any_arch_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 30
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "random_id" "spot_node_pool_name" {
  byte_length = 4
  prefix      = "spot-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "spot_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = random_id.spot_node_pool_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(local.node_labels, local.spot_node_labels)
        }
        spec = {
          nodeClassRef  = local.spot_node_class_ref
          taints        = local.spot_taints
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.any_capacity_type_requirements,
            local.amd64_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 15
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "kubectl_manifest" "wf_spot_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = "wf-${random_id.spot_node_pool_name.hex}"
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(
            local.node_labels,
            local.spot_node_labels,
            local.workflow_node_labels
          )
        }
        spec = {
          nodeClassRef  = local.spot_node_class_ref
          taints        = concat(local.spot_taints, local.workflow_taints)
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.any_capacity_type_requirements,
            local.amd64_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 15
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "random_id" "spot_arm_node_pool_name" {
  byte_length = 4
  prefix      = "spot-arm-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "spot_arm_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = random_id.spot_arm_node_pool_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(local.node_labels, local.spot_node_labels)
        }
        spec = {
          nodeClassRef = local.spot_node_class_ref
          taints = concat(
            local.spot_taints,
            local.arm_taints
          )
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.any_capacity_type_requirements,
            local.any_arch_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 20
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "kubectl_manifest" "wf_spot_arm_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = "wf-${random_id.spot_arm_node_pool_name.hex}"
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(
            local.node_labels,
            local.spot_node_labels,
            local.workflow_node_labels
          )
        }
        spec = {
          nodeClassRef = local.spot_node_class_ref
          taints = concat(
            local.spot_taints,
            local.arm_taints,
            local.workflow_taints
          )
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.any_capacity_type_requirements,
            local.any_arch_requirements
          )
          terminationGracePeriod = local.spot_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 20
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "random_id" "on_demand_arm_node_pool_name" {
  byte_length = 4
  prefix      = "on-demand-arm-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "on_demand_arm_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = random_id.on_demand_arm_node_pool_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(local.node_labels, local.worker_node_labels)
        }
        spec = {
          nodeClassRef  = local.worker_node_class_ref
          taints        = local.arm_taints
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.on_demand_capacity_type_requirements,
            local.any_arch_requirements
          )
          terminationGracePeriod = var.default_termination_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 10
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "kubectl_manifest" "wf_on_demand_arm_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = "wf-${random_id.on_demand_arm_node_pool_name.hex}"
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(
            local.node_labels,
            local.worker_node_labels,
            local.workflow_node_labels
          )
        }
        spec = {
          nodeClassRef  = local.worker_node_class_ref
          taints        = concat(local.arm_taints, local.workflow_taints)
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.on_demand_capacity_type_requirements,
            local.any_arch_requirements
          )
          terminationGracePeriod = var.default_termination_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      weight = 10
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "random_id" "on_demand_node_pool_name" {
  byte_length = 4
  prefix      = "on-demand-"
  keepers = {
    version = local.version
  }
  lifecycle {
    create_before_destroy = true
  }
}
resource "kubectl_manifest" "on_demand_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = random_id.on_demand_node_pool_name.hex
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(local.node_labels, local.worker_node_labels)
        }
        spec = {
          nodeClassRef  = local.worker_node_class_ref
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.on_demand_capacity_type_requirements,
            local.amd64_requirements
          )
          terminationGracePeriod = var.default_termination_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      // This should have the lowest preference
      weight = 5
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

resource "kubectl_manifest" "wf_on_demand_node_pool" {
  yaml_body = yamlencode({
    apiVersion = "karpenter.sh/v1"
    kind       = "NodePool"
    metadata = {
      name   = "wf-${random_id.on_demand_node_pool_name.hex}"
      labels = data.pf_kube_labels.labels.labels
    }
    spec = {
      template = {
        metadata = {
          labels = merge(
            local.node_labels,
            local.worker_node_labels,
            local.workflow_node_labels
          )
        }
        spec = {
          nodeClassRef  = local.worker_node_class_ref
          taints        = local.workflow_taints
          startupTaints = local.startup_taints
          requirements = concat(
            local.non_burstable_requirements,
            local.on_demand_capacity_type_requirements,
            local.amd64_requirements
          )
          terminationGracePeriod = var.default_termination_grace_period
          expireAfter            = local.expire_after
        }
      }
      disruption = local.disruption_policy

      // This should have the lowest preference
      weight = 5
    }
  })
  server_side_apply = true
  force_conflicts   = true
  lifecycle {
    create_before_destroy = true
  }
}

