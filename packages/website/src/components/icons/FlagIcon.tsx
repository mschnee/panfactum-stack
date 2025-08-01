// Flag icon component for feature flags and important markers
// Flag banner icon rendered as a SolidJS component with responsive sizing
import type { Component } from "solid-js";

interface FlagIconProps {
  class?: string;
  size?: string | number;
}

export const FlagIcon: Component<FlagIconProps> = (props) => {
  return (
    <svg
      width={props.size || "100%"}
      viewBox="0 0 19 20"
      fill="none"
      class={props.class}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M11 5H16.6404C17.0877 5 17.3113 5 17.4421 5.09404C17.5562 5.17609 17.6306 5.30239 17.6469 5.442C17.6656 5.602 17.5569 5.79751 17.3397 6.18851L15.9936 8.61149C15.9148 8.75329 15.8755 8.82419 15.86 8.89927C15.8463 8.96573 15.8463 9.03427 15.86 9.10073C15.8755 9.17581 15.9148 9.24671 15.9936 9.38851L17.3397 11.8115C17.5569 12.2025 17.6656 12.398 17.6469 12.558C17.6306 12.6976 17.5562 12.8239 17.4421 12.906C17.3113 13 17.0877 13 16.6404 13H9.6C9.03995 13 8.75992 13 8.54601 12.891C8.35785 12.7951 8.20487 12.6422 8.10899 12.454C8 12.2401 8 11.9601 8 11.4V9M1 19L1 2M1 9H9.4C9.96005 9 10.2401 9 10.454 8.89101C10.6422 8.79513 10.7951 8.64215 10.891 8.45399C11 8.24008 11 7.96005 11 7.4V2.6C11 2.03995 11 1.75992 10.891 1.54601C10.7951 1.35785 10.6422 1.20487 10.454 1.10899C10.2401 1 9.96005 1 9.4 1H2.6C2.03995 1 1.75992 1 1.54601 1.10899C1.35785 1.20487 1.20487 1.35785 1.10899 1.54601C1 1.75992 1 2.03995 1 2.6V9Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};
