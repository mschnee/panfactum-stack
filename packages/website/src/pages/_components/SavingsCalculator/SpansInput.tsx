import type { Component } from "solid-js";

import { IntegerInput } from "@/components/inputs/IntegerInput.tsx";
import {
  calculatorStore,
  setCalculatorStore,
} from "@/pages/_components/calculatorStore.tsx";

const SpansInput: Component = () => {
  return (
    <IntegerInput
      id={"spans"}
      label={"# of Tracing Spans / Month (Ms)"}
      value={calculatorStore.spans}
      max={100000}
      onChange={(newVal) => {
        setCalculatorStore("spans", newVal);
      }}
    />
  );
};

export default SpansInput;
