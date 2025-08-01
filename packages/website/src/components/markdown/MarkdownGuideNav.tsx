import { Progress } from "@kobalte/core/progress";
import type { Component } from "solid-js";

import MarkdownGuideNavButton from "@/components/markdown/MarkdownGuidedNavButton.tsx";

interface MarkdownGuideNavProps {
  backHref?: string;
  backText?: string;
  forwardHref?: string;
  forwardText?: string;
  stepNumber: number;
  totalSteps: number;
  progressLabel?: string;
}

const MarkdownGuideNav: Component<MarkdownGuideNavProps> = (props) => {
  return (
    <Progress
      minValue={1}
      maxValue={props.totalSteps}
      value={props.stepNumber}
      getValueLabel={({ value, max }) => `Step ${value} of ${max}`}
      class="flex w-full flex-col gap-4 py-4"
    >
      <div class="flex items-end justify-between gap-4">
        <MarkdownGuideNavButton
          href={props.backHref}
          text={props.backText || "Back"}
          icon={"left"}
        />
        <div class="flex justify-center gap-4">
          <Progress.Label class="text-display-xs font-semibold">
            {props.progressLabel || "Guide Progress"}
          </Progress.Label>
          <Progress.ValueLabel />
        </div>
        <MarkdownGuideNavButton
          href={props.forwardHref}
          text={props.forwardText || "Next"}
          icon={"right"}
        />
      </div>

      <Progress.Track
        class={`
          h-2 rounded bg-tertiary text-gray-dark-mode-50
          dark:bg-gray-dark-mode-900
        `}
      >
        <Progress.Fill
          class={`h-full w-(--kb-progress-fill-width) rounded bg-accent`}
        />
      </Progress.Track>
    </Progress>
  );
};

export default MarkdownGuideNav;
