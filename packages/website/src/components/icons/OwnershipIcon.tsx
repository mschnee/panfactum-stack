// Ownership icon component for ownership and team management features
// Grid/puzzle piece icon rendered as a SolidJS component with responsive sizing
import type { Component } from "solid-js";

interface OwnershipIconProps {
  class?: string;
  size?: string | number;
}

export const OwnershipIcon: Component<OwnershipIconProps> = (props) => {
  return (
    <svg
      width={props.size || "100%"}
      viewBox="0 0 20 20"
      fill="none"
      class={props.class}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M7 7V4C7 2.34315 5.65685 1 4 1C2.34315 1 1 2.34315 1 4C1 5.65685 2.34315 7 4 7H7ZM7 7V13M7 7H13M7 13V16C7 17.6569 5.65685 19 4 19C2.34315 19 1 17.6569 1 16C1 14.3431 2.34315 13 4 13H7ZM7 13H13M13 13H16C17.6569 13 19 14.3431 19 16C19 17.6569 17.6569 19 16 19C14.3431 19 13 17.6569 13 16V13ZM13 13V7M13 7V4C13 2.34315 14.3431 1 16 1C17.6569 1 19 2.34315 19 4C19 5.65685 17.6569 7 16 7H13Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};
