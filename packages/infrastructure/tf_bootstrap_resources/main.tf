terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "5.80.0"
    }
    pf = {
      source  = "panfactum/pf"
      version = "0.0.7"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.6.3"
    }
  }
}


data "pf_aws_tags" "tags" {
  module = "tf_bootstrap_resources"
}

data "pf_metadata" "metadata" {}

locals {
  environment = data.pf_metadata.metadata.environment
}

####################################################
## State Bucket
#####################################################

resource "aws_s3_bucket" "state" {
  bucket              = var.state_bucket
  object_lock_enabled = false
  tags = merge(data.pf_aws_tags.tags.tags, {
    description = "The terraform state bucket for ${local.environment}"
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.bucket
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.bucket
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.bucket
  versioning_configuration {
    status = "Enabled"
  }
}

data "aws_caller_identity" "id" {}

data "aws_iam_policy_document" "state" {
  statement {
    sid     = "EnforcedTLS"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      identifiers = ["*"]
      type        = "*"
    }
    resources = [
      "arn:aws:s3:::${var.state_bucket}",
      "arn:aws:s3:::${var.state_bucket}/*"
    ]
    condition {
      test     = "Bool"
      values   = ["false"]
      variable = "aws:SecureTransport"
    }
  }
  statement {
    sid     = "RootAccess"
    effect  = "Allow"
    actions = ["s3:*"]
    principals {
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.id.account_id}:root"]
      type        = "AWS"
    }
    resources = [
      "arn:aws:s3:::${var.state_bucket}",
      "arn:aws:s3:::${var.state_bucket}/*"
    ]
  }
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.bucket
  policy = data.aws_iam_policy_document.state.json
}


resource "aws_s3_bucket_lifecycle_configuration" "state" {
  # Must have bucket versioning enabled first
  depends_on = [aws_s3_bucket_versioning.state]

  bucket = aws_s3_bucket.state.bucket

  rule {
    id = "default"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }

    noncurrent_version_transition {
      noncurrent_days = 60
      storage_class   = "DEEP_ARCHIVE"
    }

    status = "Enabled"
  }
}

####################################################
## Dynamodb Table
#####################################################

resource "aws_dynamodb_table" "lock" {
  name             = var.lock_table
  billing_mode     = "PAY_PER_REQUEST"
  table_class      = "STANDARD"
  hash_key         = "LockID"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "LockID"
    type = "S"
  }

  tags = merge(data.pf_aws_tags.tags.tags, {
    description = "The state lock table for ${local.environment}"
  })

  // Table class immediately drifted on 3/4 tables and would be reapplied every time
  // Ignoring lifecycle changes since we won't be changing table class for these
  lifecycle {
    ignore_changes = [
      table_class,
    ]
  }
}

####################################################
## Backups
#####################################################

resource "random_id" "terraform" {
  prefix      = "terraform-${local.environment}-"
  byte_length = 8
}

resource "aws_backup_vault" "terraform" {
  name = random_id.terraform.hex
  tags = merge(
    data.pf_aws_tags.tags.tags,
    {
      description = "Backups of the terraform state for ${local.environment}"
    }
  )
  force_destroy = true
}

resource "aws_backup_plan" "terraform" {
  name = random_id.terraform.hex
  rule {
    rule_name                = "continuous"
    target_vault_name        = aws_backup_vault.terraform.name
    schedule                 = "cron(0 * * * ? *)"
    completion_window        = 120 //minutes (min)
    start_window             = 60  // minutes (min)
    enable_continuous_backup = true
    lifecycle {
      delete_after = 1 //days
    }
  }
  tags = data.pf_aws_tags.tags.tags
}

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "terraform" {
  name_prefix        = "terraform-backups-"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = data.pf_aws_tags.tags.tags
}

data "aws_iam_policy_document" "backup" {
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObjectAcl",
      "s3:GetObject",
      "s3:GetObjectVersionTagging",
      "s3:GetObjectVersionAcl",
      "s3:GetObjectTagging",
      "s3:GetObjectVersion",
      "s3:DeleteObject",
      "s3:PutObjectVersionAcl",
      "s3:PutObjectTagging",
      "s3:GetObjectAcl",
      "s3:PutObjectAcl",
      "s3:ListMultipartUploadParts",
      "s3:PutObject"
    ]
    resources = ["${aws_s3_bucket.state.arn}/*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "s3:GetBucketTagging",
      "s3:GetInventoryConfiguration",
      "s3:ListBucketVersions",
      "s3:ListBucket",
      "s3:GetBucketVersioning",
      "s3:GetBucketLocation",
      "s3:GetBucketAcl",
      "s3:PutInventoryConfiguration",
      "s3:GetBucketNotification",
      "s3:PutBucketNotification",
      "s3:PutBucketVersioning",
      "s3:PutBucketOwnershipControls",
      "s3:CreateBucket"
    ]
    resources = [aws_s3_bucket.state.arn]
  }
  statement {
    effect    = "Allow"
    actions   = ["s3:ListAllMyBuckets"]
    resources = ["*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["cloudwatch:GetMetricData"]
    resources = ["*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "events:DeleteRule",
      "events:PutTargets",
      "events:DescribeRule",
      "events:EnableRule",
      "events:PutRule",
      "events:RemoveTargets",
      "events:ListTargetsByRule",
      "events:DisableRule"
    ]
    resources = ["arn:aws:events:*:*:rule/AwsBackupManagedRule*"]
  }
  statement {
    effect    = "Allow"
    actions   = ["events:ListRules"]
    resources = ["*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:GenerateDataKey"
    ]
    resources = ["*"]
    condition {
      test     = "StringLike"
      values   = ["s3.*.amazonaws.com"]
      variable = "kms:ViaService"
    }
  }
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:CreateBackup",
      "dynamodb:Scan",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:DeleteItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:DescribeTable",
      "dynamodb:RestoreTableFromAwsBackup",
      "dynamodb:ListTagsOfResource",
      "dynamodb:StartAwsBackupJob"
    ]
    resources = [aws_dynamodb_table.lock.arn]
  }
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:DescribeBackup",
      "dynamodb:DeleteBackup",
      "dynamodb:RestoreTableFromBackup"
    ]
    resources = ["${aws_dynamodb_table.lock.arn}/backup/*"]
  }

  statement {
    effect = "Allow"
    actions = [
      "backup:TagResource"
    ]
    resources = ["*"] # Or scope to specific backup resources if preferred
  }

  // Note sure why this is required for dynamodb backups
  // but it is listed on
  // https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSBackupServiceRolePolicyForBackup.html
  statement {
    effect = "Allow"
    actions = [
      "rds:AddTagsToResource",
      "rds:ListTagsForResource",
      "rds:DescribeDBSnapshots",
      "rds:CreateDBSnapshot",
      "rds:CopyDBSnapshot",
      "rds:DescribeDBInstances",
      "rds:CreateDBClusterSnapshot",
      "rds:DescribeDBClusters",
      "rds:DescribeDBClusterSnapshots",
      "rds:CopyDBClusterSnapshot",
      "rds:DescribeDBClusterAutomatedBackups"
    ]
    resources = ["*"]
  }
  statement {
    effect = "Allow"
    actions = [
      "kms:DescribeKey",
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:ReEncryptTo",
      "kms:ReEncryptFrom",
      "kms:GenerateDataKeyWithoutPlaintext"
    ]
    resources = ["*"]
    condition {
      test     = "StringLike"
      values   = ["dynamodb.*.amazonaws.com"]
      variable = "kms:ViaService"
    }
  }
}

resource "aws_iam_policy" "terraform" {
  name_prefix = "terraform-${local.environment}-backup-"
  policy      = data.aws_iam_policy_document.backup.json
  tags        = data.pf_aws_tags.tags.tags
}

resource "aws_iam_role_policy_attachment" "terraform" {
  policy_arn = aws_iam_policy.terraform.arn
  role       = aws_iam_role.terraform.name
}

resource "aws_backup_selection" "terraform" {
  iam_role_arn = aws_iam_role.terraform.arn
  name         = "tf_example_backup_selection"
  plan_id      = aws_backup_plan.terraform.id

  resources = [
    aws_s3_bucket.state.arn,
    aws_dynamodb_table.lock.arn
  ]
}

