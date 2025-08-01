// Thunder bolt icon component for power and energy-related visual elements
// SVG icon rendered as a SolidJS component with responsive sizing and color support
import type { Component } from "solid-js";

interface ThunderBoltIconProps {
  class?: string;
  size?: string | number;
}

export const ThunderBoltIcon: Component<ThunderBoltIconProps> = (props) => {
  return (
    <svg
      width={props.size || "100%"}
      viewBox="0 0 20 22"
      fill="none"
      class={props.class}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10.9999 1L2.09332 11.6879C1.74451 12.1064 1.57011 12.3157 1.56744 12.4925C1.56512 12.6461 1.63359 12.7923 1.75312 12.8889C1.89061 13 2.16304 13 2.7079 13H9.99986L8.99986 21L17.9064 10.3121C18.2552 9.89358 18.4296 9.68429 18.4323 9.50754C18.4346 9.35388 18.3661 9.2077 18.2466 9.11111C18.1091 9 17.8367 9 17.2918 9H9.99986L10.9999 1Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};
