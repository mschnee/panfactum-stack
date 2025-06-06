import { Select } from "@kobalte/core/select";
import { clsx } from "clsx";
import { FiChevronDown, FiCheck } from "solid-icons/fi";
import { type Component, Show } from "solid-js";

import { DOCS_VERSIONS, type VersionOption } from "@/lib/constants.ts";
import { useDocsVersion } from "@/state/docsVersion.tsx";

const VersionSelector: Component = () => {
  const [version, setDocsVersion] = useDocsVersion();

  const selectedVersion = () =>
    DOCS_VERSIONS.find((option) => option.slug === version());

  return (
    <Select<VersionOption>
      options={DOCS_VERSIONS}
      optionValue={(option) => option.slug}
      optionTextValue={(option) => option.label}
      value={selectedVersion()}
      onChange={(option) => {
        if (option) {
          setDocsVersion(option.slug);
        }
        return option;
      }}
      itemComponent={(props) => {
        return (
          <Select.Item
            item={props.item}
            as="li"
            class="focus:bg-accent relative flex w-full cursor-pointer select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none"
          >
            <Select.ItemLabel>{props.item.rawValue.label}</Select.ItemLabel>
            <Show when={props.item.rawValue.slug === version()}>
              <FiCheck />
            </Show>
          </Select.Item>
        );
      }}
      class="z-[1000]"
    >
      <Select.Trigger
        aria-label="Documentation Version"
        class={clsx(
          "border-primary flex h-10 w-full  items-center justify-between whitespace-nowrap rounded-md border bg-gray-light-mode-100 px-3 py-2 text-sm shadow-sm hover:bg-gray-light-mode-300 focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-dark-mode-800 hover:dark:bg-gray-dark-mode-700",
        )}
      >
        <span>{selectedVersion()?.label}</span>
        <FiChevronDown />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          class={
            "border-secondary relative z-[10000] max-h-96 min-w-32 overflow-hidden rounded-md border bg-gray-light-mode-100 shadow-md dark:bg-gray-dark-mode-800"
          }
        >
          <Select.Listbox class="z-[200] flex flex-col gap-2 py-2" />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
};

export default VersionSelector;
