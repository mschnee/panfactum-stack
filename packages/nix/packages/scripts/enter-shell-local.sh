#!/usr/bin/env bash

set -eo pipefail

# This script is meant to be sourced inside the enterShell
# parameter of our devenv.nix

REPO_VARIABLES=$(pf config get)
KUBE_DIR=$(echo "$REPO_VARIABLES" | jq -r '.kube_dir')
AWS_DIR=$(echo "$REPO_VARIABLES" | jq -r '.aws_dir')
REPO_ROOT=$(echo "$REPO_VARIABLES" | jq -r '.repo_root')
BUILDKIT_DIR=$(echo "$REPO_VARIABLES" | jq -r '.buildkit_dir')

#############################################
## General Metadata
#############################################
export CI="false"
export PF_DEVSHELL=1

#############################################
## Kubernetes
#############################################

# Use repo-local kubeconfig file
export KUBECONFIG="$KUBE_DIR/config"
export KUBE_CONFIG_PATH=$KUBECONFIG

#############################################
## AWS
#############################################

# Use repo-local AWS settings
export AWS_SHARED_CREDENTIALS_FILE="$AWS_DIR/credentials"
export AWS_CONFIG_FILE="$AWS_DIR/config"

# Prevent settings from outside the devshell from polluting the system
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY

#############################################
## IaC
#############################################

# Use repo-local terragrunt downloads
export TERRAGRUNT_DOWNLOAD="$REPO_ROOT/.terragrunt-cache"

# This speeds up terragrunt commands that have dependencies significantly
# See https://terragrunt.gruntwork.io/docs/reference/cli-options/#terragrunt-fetch-dependency-output-from-state
export TERRAGRUNT_FETCH_DEPENDENCY_OUTPUT_FROM_STATE="true"

# Ensure that tofu output is not wrapped in the terragrunt logger
export TERRAGRUNT_FORWARD_TF_STDOUT=1

# Enables the local provider cache so that the provider binaries to significantly
# reduce the amount of times that we need to download provider binaries
export TF_PLUGIN_CACHE_DIR="$REPO_ROOT/.terraform"
mkdir -p "$TF_PLUGIN_CACHE_DIR"

#############################################
## Git LFS Fix
## This should be removed when updating to git 2.45
## as the new security features enables by this flag are
## currently broken for LFS. This doesn't disable
## any prior security features.
#############################################
export GIT_CLONE_PROTECTION_ACTIVE=false

#############################################
## Local BuildKit Configuration
#############################################
export REGISTRY_AUTH_FILE="$BUILDKIT_DIR/config.json"
export DOCKER_CONFIG=$BUILDKIT_DIR # Needed for buildkit to work

#############################################
## Welcome Screen
#############################################

pf welcome
