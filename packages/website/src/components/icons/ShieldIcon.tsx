// Shield icon component for security and protection features
// Shield protection icon rendered as a SolidJS component with responsive sizing
import type { Component } from "solid-js";

interface ShieldIconProps {
  class?: string;
  size?: string | number;
}

export const ShieldIcon: Component<ShieldIconProps> = (props) => {
  return (
    <svg
      width={props.size || "100%"}
      viewBox="0 0 18 22"
      fill="none"
      class={props.class}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8.30201 20.615C8.5234 20.7442 8.6341 20.8087 8.79032 20.8422C8.91156 20.8682 9.08844 20.8682 9.20968 20.8422C9.3659 20.8087 9.4766 20.7442 9.69799 20.615C11.646 19.4785 17 15.9086 17 11.0001V6.21772C17 5.4182 17 5.01845 16.8692 4.67482C16.7537 4.37126 16.566 4.10039 16.3223 3.88564C16.0465 3.64255 15.6722 3.50219 14.9236 3.22146L9.5618 1.21079C9.3539 1.13283 9.24995 1.09385 9.14302 1.07839C9.04816 1.06469 8.95184 1.06469 8.85698 1.07839C8.75005 1.09385 8.6461 1.13283 8.4382 1.21079L3.0764 3.22146C2.3278 3.50219 1.9535 3.64255 1.67766 3.88564C1.43398 4.10039 1.24627 4.37126 1.13076 4.67482C1 5.01845 1 5.4182 1 6.21772V11.0001C1 15.9086 6.35396 19.4785 8.30201 20.615Z"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};
