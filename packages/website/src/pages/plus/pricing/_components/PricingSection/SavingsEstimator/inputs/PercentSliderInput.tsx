import { Slider } from "@kobalte/core/slider";
import { type Component } from "solid-js";
import "./PercentSliderInput.css";

interface IntegerSliderInputProps {
  id: string;
  label: string;
  value: number;
  step?: number;
  minValue: number;
  maxValue: number;
  description?: string | Component;
  onChange: (newVal: number) => void;
}

const PercentSliderInput: Component<IntegerSliderInputProps> = (props) => {
  return (
    <Slider
      class="col-span-full flex w-full flex-col gap-8 py-4 sm:flex-row"
      value={[props.value]}
      onChange={(values) => {
        props.onChange(values[0]);
      }}
      minValue={props.minValue}
      maxValue={props.maxValue}
      step={props.step}
      getValueLabel={({ values }) => `${values[0]}%`}
    >
      <Slider.Label for={props.id} class="sr-only">
        {props.label}
      </Slider.Label>
      <div class="flex items-center gap-2">
        <span class="text-display-xs inline font-semibold sm:hidden">
          Utilization:{" "}
        </span>
        <Slider.ValueLabel class="text-display-xs w-10 font-semibold" />
      </div>

      <div class="flex w-full items-center gap-6">
        <span>{props.minValue}%</span>
        <Slider.Track class="relative h-2 w-full rounded-full bg-gray-light-mode-500 dark:bg-gray-dark-mode-200">
          <Slider.Fill class="bg-accent-light absolute h-full rounded-full" />
          <Slider.Thumb class="bg-accent-light -top-2 size-6 cursor-pointer rounded-full">
            <Slider.Input />
          </Slider.Thumb>
        </Slider.Track>
        <span>{props.maxValue}%</span>
      </div>
    </Slider>
  );
};

export default PercentSliderInput;
