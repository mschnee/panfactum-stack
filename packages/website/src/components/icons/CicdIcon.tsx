// CI/CD icon component for continuous integration and deployment features
// Pipeline/workflow icon rendered as a SolidJS component with responsive sizing
import type { Component } from "solid-js";

interface CicdIconProps {
  class?: string;
  size?: string | number;
}

export const CicdIcon: Component<CicdIconProps> = (props) => {
  return (
    <svg
      width={props.size || "100%"}
      viewBox="0 0 20 20"
      fill="none"
      class={props.class}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13 16C13 17.6569 14.3431 19 16 19C17.6569 19 19 17.6569 19 16C19 14.3431 17.6569 13 16 13C14.3431 13 13 14.3431 13 16ZM13 16C10.6131 16 8.32387 15.0518 6.63604 13.364C4.94821 11.6761 4 9.38695 4 7M4 7C5.65685 7 7 5.65685 7 4C7 2.34315 5.65685 1 4 1C2.34315 1 1 2.34315 1 4C1 5.65685 2.34315 7 4 7ZM4 7V19"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};
