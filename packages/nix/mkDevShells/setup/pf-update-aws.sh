#!/usr/bin/env bash

set -eo pipefail

# Purpose: Adds the standard .aws configuration files

REPO_VARIABLES=$(pf-get-repo-variables)
AWS_DIR=$(echo "$REPO_VARIABLES" | jq -r '.aws_dir')
ENVIRONMENTS_DIR=$(echo "$REPO_VARIABLES" | jq -r '.environments_dir')

if [[ $1 == "-b" ]] || [[ $1 == "--build" ]]; then
  BUILD_AWS_CONFIG="1"
else
  BUILD_AWS_CONFIG="0"
fi

############################################################
## Step 1: Copy the static files
############################################################

destination=$AWS_DIR
source=$(dirname "$(dirname "$(realpath "$0")")")/files/aws

mkdir -p "$destination"

rsync -rp --chmod=Du=rwx,Dg=rx,Do=rx,Fu=rw,Fg=r,Fo=r "$source"/ "$destination"/

############################################################
## Step 2: Dynamically configure known_hosts
############################################################

CONFIG_FILE="$AWS_DIR/config.yaml"
AWS_CONFIG_FILE="$AWS_DIR/config"
AWS_TMP_CONFIG_FILE="$AWS_DIR/config.tmp"

if [[ $BUILD_AWS_CONFIG == "1" ]]; then
  if [[ -f $CONFIG_FILE ]]; then

    ############################################################
    ## Step 2.1: Parse the config file
    ############################################################

    SSO_START_URL=$(yq -r ".sso_start_url" "$CONFIG_FILE")
    SSO_REGION=$(yq -r ".sso_region" "$CONFIG_FILE")
    DEFAULT_AWS_REGION=$(yq -r ".default_aws_region" "$CONFIG_FILE")
    MODULE=$(yq -r ".module" "$CONFIG_FILE")
    EXTRA_ROLES=$(yq -r ".extra_roles" "$CONFIG_FILE")

    if [[ $SSO_START_URL == "null" ]]; then
      echo "Error: sso_start_url is not set. Add it to the config.yaml." >&2
      exit 1
    elif [[ $SSO_REGION == "null" ]]; then
      echo "Error: sso_region is not set. Add it to the config.yaml." >&2
      exit 1
    fi

    ############################################################
    ## Step 2.2: Construct the config builder
    ############################################################
    function camelToSnakeCase() {
      # shellcheck disable=SC2019,SC2018
      tmp="$(echo "$1" | sed -r 's/([A-Z])/-\1/g' | tr 'A-Z' 'a-z')" # coverts to snake
      echo "${tmp#\-}"                                               # removes leading -
    }

    function append_to_config() {
      touch "$AWS_TMP_CONFIG_FILE"
      NUMBER_OF_ACCOUNTS=$(echo "$1" | jq -r 'length')
      for ((i = 0; i < NUMBER_OF_ACCOUNTS; i++)); do
        ACCOUNT_NAME=$(echo "$1" | jq -r ".[$i].account_name")
        ACCOUNT_ID=$(echo "$1" | jq -r ".[$i].account_id")
        ROLES=$(echo "$1" | jq -r ".[$i].roles")

        if [[ $ACCOUNT_NAME == "null" ]]; then
          echo "Error: account_name is not set at index $i." >&2
          exit 1
        elif [[ $ACCOUNT_ID == "null" ]]; then
          echo "Error: account_id is not set at index $i." >&2
          exit 1
        elif [[ $ROLES == "null" ]]; then
          echo "Error: roles is not set at index $i." >&2
          exit 1
        fi

        NUMBER_OF_ROLES=$(echo "$ROLES" | jq -r 'length')
        for ((j = 0; j < NUMBER_OF_ROLES; j++)); do
          ROLE=$(echo "$ROLES" | jq -r ".[$j]")
          PROFILE_NAME="$(camelToSnakeCase "$ACCOUNT_NAME")-$(camelToSnakeCase "$ROLE")"
          {
            echo "[profile ${PROFILE_NAME}]"
            echo "sso_session = ${PROFILE_NAME}"
            echo "sso_account_id = ${ACCOUNT_ID}"
            echo "sso_role_name = ${ROLE}"
            echo "output = text"
            if [[ $DEFAULT_AWS_REGION != "null" ]]; then
              echo "region = ${DEFAULT_AWS_REGION}"
            fi
            echo "[sso-session ${PROFILE_NAME}]"
            echo "sso_start_url = ${SSO_START_URL}"
            echo "sso_region = ${SSO_REGION}"
            echo "sso_registration_scopes = sso:account:access"
            echo ""
          } >>"$AWS_TMP_CONFIG_FILE"
        done
      done
    }

    ############################################################
    ## Step 2.3: Add config from module outputs (if provided)
    ############################################################

    if [[ $MODULE != "null" ]]; then
      MODULE_PATH="$ENVIRONMENTS_DIR/$MODULE"
      echo "Retrieving roles from $MODULE_PATH..." >&2
      MODULE_OUTPUT="$(terragrunt output --json --terragrunt-working-dir="$MODULE_PATH" | jq -r '.cli_config.value')"
      append_to_config "$MODULE_OUTPUT"
      echo "Roles retrieved." >&2
    else
      echo "Warning: module not specified. Not retrieving dynamic roles." >&2
    fi

    ############################################################
    ## Step 2.4: Add static config (if provided)
    ############################################################
    if [[ $EXTRA_ROLES != "null" ]]; then
      echo "Adding static roles from config file..." >&2
      append_to_config "$EXTRA_ROLES"
      echo "Roles added." >&2
    fi

    ############################################################
    ## Step 2.5: Make the tmp config the real config
    ############################################################
    mv "$AWS_TMP_CONFIG_FILE" "$AWS_CONFIG_FILE"

  else
    echo "Warning: No configuration file exists at $CONFIG_FILE Skipping config setup..." >&2
  fi
fi

# Save the state hash
pf-get-aws-state-hash >"$AWS_DIR/state.lock"

echo -e "AWS config files in $AWS_DIR were updated.\n" 1>&2

if [[ $PF_SKIP_CHECK_REPO_SETUP != 1 ]]; then
  pf-check-repo-setup
fi
