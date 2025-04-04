import { clsx } from "clsx";
import { createMemo, For, onMount, Show } from "solid-js";
import type { Component } from "solid-js";

import {
  calculatorStore,
  PlanOptions,
  setCalculatorStore,
  seedCalculator,
} from "@/pages/_components/PricingSection/calculatorStore";

import ContactUs from "./ContactUs";
import EnterpriseOptions from "./PlanTiers/EnterpriseOptions";
import FlatRateOptions from "./PlanTiers/FlatRateOptions";
import UsageOptions from "./PlanTiers/UsageOptions";
import PlanTotalRow from "./PlanTotalRow/PlanTotalRow";
import SavingsEstimator from "./SavingsEstimator/SavingsEstimator";
import { calculatePlanPrice } from "./calculatePlanPrice";

const PriceCalculator: Component = () => {
  onMount(() => {
    seedCalculator();
  });
  const price = createMemo(() =>
    calculatePlanPrice({
      plan: calculatorStore.plan,
      workloadCount: calculatorStore.workloadCount,
      clusterCount: calculatorStore.clusterCount,
      dbCount: calculatorStore.dbCount,
      moduleCount: calculatorStore.moduleCount,
      prioritySupportEnabled: calculatorStore.prioritySupportEnabled,
      supportHours: calculatorStore.supportHours,
      annualSpendCommitmentEnabled:
        calculatorStore.annualSpendCommitmentEnabled,
    }),
  );

  const tabItemClasses =
    "flex cursor-pointer items-center justify-center text-nowrap rounded p-2 md:px-6 text-sm font-semibold hover:bg-gray-dark-mode-200 hover:text-black md:text-lg";

  return (
    <div class="flex w-full flex-col gap-8">
      <div class="flex flex-wrap gap-8">
        <div class="flex flex-col gap-2">
          <div class="text-display-xs font-semibold">Commitment:</div>
          <div class="flex h-16 gap-4 rounded-md bg-brand-700 p-2 shadow-md md:h-20 md:p-4 dark:bg-brand-800">
            <button
              onClick={() => {
                setCalculatorStore("annualSpendCommitmentEnabled", false);
              }}
              class={clsx(
                tabItemClasses,
                "w-1/2",
                !calculatorStore.annualSpendCommitmentEnabled &&
                  "bg-gray-dark-mode-200 text-black",
              )}
            >
              On-demand
            </button>
            <button
              class={clsx(
                tabItemClasses,
                "flex w-1/2 flex-col",
                calculatorStore.annualSpendCommitmentEnabled &&
                  "bg-gray-dark-mode-200 !text-black",
              )}
              onClick={() => {
                setCalculatorStore("annualSpendCommitmentEnabled", true);
              }}
            >
              <div>
                Annual<sup>*</sup>
              </div>
            </button>
          </div>
          <div class="text-secondary text-nowrap text-xs italic">
            <sup>*</sup>All plans are invoiced monthly
          </div>
        </div>

        <div class="flex grow flex-col gap-2">
          <div class="text-display-xs font-semibold">
            Select your monthly AWS spend:
          </div>
          <div class="flex h-12 gap-4 rounded-md bg-brand-700 p-2 shadow-md md:h-20 md:p-4 dark:bg-brand-800">
            <For each={PlanOptions}>
              {(option) => (
                <button
                  class={clsx(
                    tabItemClasses,
                    "w-1/4",
                    calculatorStore.plan === option.value &&
                      "bg-gray-dark-mode-200 text-black",
                  )}
                  onClick={() => {
                    setCalculatorStore("plan", option.value);
                  }}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="flex flex-col">
        <div class="text-display-xs font-semibold">Scale your team:</div>
        <div class="bg-primary z-10 mt-2 flex flex-col rounded-xl shadow shadow-gray-dark-mode-800">
          <Show when={calculatorStore.plan === 1}>
            <FlatRateOptions />
          </Show>
          <Show when={calculatorStore.plan === 2 || calculatorStore.plan === 3}>
            <UsageOptions
              discount={-price().perClusterDiscounts}
              clusterPrice={price().perClusterPrice}
            />
          </Show>
          <Show when={calculatorStore.plan === 4}>
            <EnterpriseOptions />
          </Show>
          <Show when={calculatorStore.plan !== 4}>
            <PlanTotalRow
              price={price().total}
              daysToLaunch={price().daysToLaunch}
            />
          </Show>
        </div>
        <Show when={calculatorStore.plan !== 4}>
          <SavingsEstimator supportPlanPrice={price().total} />
        </Show>
      </div>

      <Show when={calculatorStore.plan !== 4}>
        <ContactUs />
      </Show>
    </div>
  );
};

export default PriceCalculator;
