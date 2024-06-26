'use client'

import Slider from '@mui/material/Slider'
import Snackbar from '@mui/material/Snackbar'
import TextField from '@mui/material/TextField'
import { usePathname } from 'next/navigation'
import { parseAsInteger, useQueryState } from 'nuqs'
import type { ChangeEvent, ReactElement, KeyboardEvent } from 'react'
import { useMemo, useState, useCallback } from 'react'
import { useLocalStorage } from 'usehooks-ts'

import SavingsTable from '@/app/stack/savings/SavingsTable'
import DefaultTooltipLazy from '@/components/tooltip/DefaultTooltipLazy'

const NUMBER = /^[0-9]+$/

// Prevents non-integer inputs to form field
function allowOnlyIntegers (event: KeyboardEvent) {
  const value = event.key
  if (!event.shiftKey && !event.ctrlKey && !event.metaKey && value.length === 1 && !NUMBER.test(value)) {
    event.preventDefault()
  }
}

function setIntFromString (value: string, setter: (value: number) => unknown, max = 100000) {
  if (value.length === 0) {
    void setter(0)
  } else if (NUMBER.test(value)) {
    const intValue = parseInt(value)
    if (intValue >= 0 && intValue <= max) { void setter(intValue) }
  }
}

// This function gets the value with the following precedence:
// - query string
// - local storage
// - default
// It will also update the query string and local storage when the value changes.
function useIntegerInput (name: string, defaultValue: number, maxValue?: number) {
  const [localValue, setLocalValue] = useLocalStorage<number>(`sc-${name}`, defaultValue, { initializeWithValue: false })
  const [qsValue, setQSValue] = useQueryState(name, parseAsInteger)
  const setValue = useCallback((newValue: number) => {
    setLocalValue(newValue)
    void setQSValue(newValue)
  }, [setLocalValue, setQSValue])
  const onValueChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setIntFromString(value, setValue, maxValue)
  }, [setValue, maxValue])

  return [qsValue ?? localValue, setValue, onValueChange] as const
}

function InputRow ({ children, title }: {children: ReactElement, title: string | ReactElement}) {
  return (
    <div className="w-full flex flex-row gap-x-6 gap-y-6 items-center flex-wrap justify-center lg:justify-start">
      <div className="w-full lg:w-48 text-center lg:text-left text-lg font-medium">
        {title}
      </div>
      {children}
    </div>
  )
}

function IntegerInput ({ id, label, value, onChange }: {id: string, label: string, value: number, onChange: (e: ChangeEvent<HTMLInputElement>) => void}) {
  return (
    <TextField
      id={id}
      label={label}
      type="number"
      className={'w-fit'}
      inputProps={{
        step: 1
      }}
      InputLabelProps={{
        shrink: true
      }}
      value={JSON.stringify(value)}
      onKeyDown={allowOnlyIntegers}
      onChange={onChange}
    />
  )
}

export default function Calculator () {
  const [utilization, _, onUtilizationChange] = useIntegerInput('utilization', 25, 65)
  const [workloadCores, setWorkloadCores, onWorkloadCoresChange] = useIntegerInput('workload-cores', 3)
  const [workloadMemory, setWorkloadMemory, onWorkloadMemoryChange] = useIntegerInput('workload-memory', 6)
  const [pgCores, setPGCores, onPGCoresChange] = useIntegerInput('pg-cores', 1)
  const [pgMemory, setPGMemory, onPGMemoryChange] = useIntegerInput('pg-memory', 2)
  const [pgStorage, setPGStorage, onPGStorageChange] = useIntegerInput('pg-storage', 10)
  const [kvCores, setKVCores, onKVCoresChange] = useIntegerInput('kv-cores', 1)
  const [kvMemory, setKVMemory, onKVMemoryChange] = useIntegerInput('kv-memory', 2)
  const [kvStorage, setKVStorage, onKVStorageChange] = useIntegerInput('kv-storage', 0)
  const [vpcCount, setVPCCount, onVPCCountChange] = useIntegerInput('vpc-count', 1)
  const [egressTraffic, setEgressTraffic, onEgressTrafficChange] = useIntegerInput('egress-traffic', 100)
  const [interAZTraffic, setInterAZTraffic, onInterAZTrafficChange] = useIntegerInput('inter-az-traffic', 1000)
  const [logs, setLogs, onLogsChange] = useIntegerInput('logs', 1000)
  const [metrics, setMetrics, onMetricsChange] = useIntegerInput('metrics', 10)
  const [spans, setSpans, onSpansChange] = useIntegerInput('spans', 10)
  const [employeeCount, setEmployees, onEmployeesChange] = useIntegerInput('employees', 10)
  const [developerCount, setDevelopers, onDevelopersChange] = useIntegerInput('developers', 10)
  const [cicdMinutes, setCICDMinutes, onCICDMinutesChange] = useIntegerInput('cicd-minutes', 60 * 24 * 30)
  const [lablorCostHourly, __, onLaborCostHourlyChange] = useIntegerInput('labor-cost', 100)

  const { setSmallPreset, setMediumPreset, setLargePreset, setSoloPreset } = useMemo(() => ({
    setSoloPreset: () => {
      void setEmployees(1)
      void setDevelopers(1)
      void setVPCCount(1)
      void setEgressTraffic(10)
      void setInterAZTraffic(100)
      void setWorkloadCores(1)
      void setWorkloadMemory(2)
      void setPGCores(1)
      void setPGMemory(1)
      void setPGStorage(10)
      void setKVCores(0)
      void setKVMemory(0)
      void setKVStorage(0)
      void setMetrics(0)
      void setLogs(10)
      void setSpans(0)
      void setCICDMinutes(60 * 24 * 10)
    },
    setSmallPreset: () => {
      void setEmployees(5)
      void setDevelopers(2)
      void setVPCCount(1)
      void setEgressTraffic(100)
      void setInterAZTraffic(1000)
      void setWorkloadCores(3)
      void setWorkloadMemory(6)
      void setPGCores(1)
      void setPGMemory(2)
      void setPGStorage(10)
      void setKVCores(1)
      void setKVMemory(2)
      void setKVStorage(0)
      void setMetrics(10)
      void setLogs(10)
      void setSpans(10)
      void setCICDMinutes(60 * 24 * 30)
    },
    setMediumPreset: () => {
      void setEmployees(50)
      void setDevelopers(10)
      void setVPCCount(3)
      void setEgressTraffic(1000)
      void setInterAZTraffic(10000)
      void setWorkloadCores(15)
      void setWorkloadMemory(30)
      void setPGCores(10)
      void setPGMemory(20)
      void setPGStorage(100)
      void setKVCores(10)
      void setKVMemory(20)
      void setKVStorage(10)
      void setMetrics(100)
      void setLogs(100)
      void setSpans(100)
      void setCICDMinutes(60 * 24 * 30 * 10)
    },
    setLargePreset: () => {
      void setEmployees(250)
      void setDevelopers(50)
      void setVPCCount(6)
      void setEgressTraffic(10000)
      void setInterAZTraffic(100000)
      void setWorkloadCores(100)
      void setWorkloadMemory(300)
      void setPGCores(50)
      void setPGMemory(200)
      void setPGStorage(1000)
      void setKVCores(25)
      void setKVMemory(100)
      void setKVStorage(100)
      void setMetrics(250)
      void setLogs(1000)
      void setSpans(1000)
      void setCICDMinutes(60 * 24 * 30 * 50)
    }
  }), [
    setEmployees,
    setDevelopers,
    setVPCCount,
    setEgressTraffic,
    setInterAZTraffic,
    setWorkloadCores,
    setWorkloadMemory,
    setPGCores,
    setPGMemory,
    setPGStorage,
    setKVCores,
    setKVMemory,
    setKVStorage,
    setSpans,
    setLogs,
    setMetrics,
    setCICDMinutes
  ])
  const [snackbarOpen, setSnackbarOpen] = useState(false)

  const closeSnackbar = useCallback(() => {
    setSnackbarOpen(false)
  }, [setSnackbarOpen])

  const path = usePathname()

  const copyLinkToClipboard = useCallback(() => {
    const qs = (new URLSearchParams([
      ['utilization', JSON.stringify(utilization)],
      ['workload-cores', JSON.stringify(workloadCores)],
      ['workload-memory', JSON.stringify(workloadMemory)],
      ['pg-cores', JSON.stringify(pgCores)],
      ['pg-memory', JSON.stringify(pgMemory)],
      ['pg-storage', JSON.stringify(pgStorage)],
      ['kv-cores', JSON.stringify(kvCores)],
      ['kv-memory', JSON.stringify(kvMemory)],
      ['kv-storage', JSON.stringify(kvStorage)],
      ['vpc-count', JSON.stringify(vpcCount)],
      ['egress-traffic', JSON.stringify(egressTraffic)],
      ['inter-az-traffic', JSON.stringify(interAZTraffic)],
      ['logs', JSON.stringify(logs)],
      ['metrics', JSON.stringify(metrics)],
      ['spans', JSON.stringify(spans)],
      ['employees', JSON.stringify(employeeCount)],
      ['developers', JSON.stringify(developerCount)],
      ['cicd-minutes', JSON.stringify(cicdMinutes)],
      ['labor-cost', JSON.stringify(lablorCostHourly)]
    ])).toString()
    void navigator.clipboard.writeText(`https://panfactum.com${path}?${qs}`)
    setSnackbarOpen(true)
  }, [
    utilization,
    workloadCores,
    workloadMemory,
    pgCores,
    pgMemory,
    pgStorage,
    kvCores,
    kvMemory,
    kvStorage,
    vpcCount,
    egressTraffic,
    interAZTraffic,
    logs,
    metrics,
    spans,
    employeeCount,
    developerCount,
    cicdMinutes,
    path,
    setSnackbarOpen,
    lablorCostHourly
  ])

  return (
    <div className="py-8 px-8">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">
        <h1
          className="text-3xl lg:text-5xl text-center py-4"
        >
          Savings Calculator
        </h1>
        <div className="flex flex-col items-center max-w-7xl mx-auto gap-6">
          <div className="w-full flex flex-row gap-x-2 lg:gap-x-6 gap-y-6 items-center flex-wrap justify-center lg:justify-start">
            <div className="w-full lg:w-48 text-center lg:text-left text-lg font-medium">
              Size Presets
            </div>
            <button
              className="bg-primary text-white py-2 px-4 lg:px-8 rounded font-semibold sm:text-base"
              onClick={setSoloPreset}
            >
              Solo
            </button>
            <button
              className="bg-primary text-white py-2 px-4 lg:px-8 rounded font-semibold sm:text-base"
              onClick={setSmallPreset}
            >
              Small
            </button>
            <button
              className="bg-primary text-white py-2 px-4 lg:px-8 rounded font-semibold sm:text-base"
              onClick={setMediumPreset}
            >
              Medium
            </button>
            <button
              className="bg-primary text-white py-2 px-4 lg:px-8 rounded font-semibold sm:text-base"
              onClick={setLargePreset}
            >
              Large
            </button>
          </div>
          <InputRow title={'Organization'}>
            <>
              <IntegerInput
                id="employee-count"
                label="Number of Employees"
                value={employeeCount}
                onChange={onEmployeesChange}
              />
              <IntegerInput
                id="developer-count"
                label="Number of Developers"
                value={developerCount}
                onChange={onDevelopersChange}
              />
              <IntegerInput
                id="labor-cost"
                label="Developer Cost (Hourly USD)"
                value={lablorCostHourly}
                onChange={onLaborCostHourlyChange}
              />
            </>
          </InputRow>
          <InputRow title={'Network'}>
            <>
              <IntegerInput
                id="vpc-count"
                label="Number of VPCs"
                value={vpcCount}
                onChange={onVPCCountChange}
              />
              <IntegerInput
                id="egress-traffic"
                label="Outbound Traffic GB / Month"
                value={egressTraffic}
                onChange={onEgressTrafficChange}
              />
              <IntegerInput
                id="inter-az-traffic"
                label="Inter-AZ Traffic GB / Month"
                value={interAZTraffic}
                onChange={onInterAZTrafficChange}
              />
            </>
          </InputRow>
          <InputRow
            title={(
              <DefaultTooltipLazy
                title={'The average percent of provisioned resource capacity actually being used by your workloads. A normal range is 20-30% and a ceiling is 65% as you should always have hot spare capacity.'}
              >
                <span className="underline decoration-dotted decoration-black decoration-2 underline-offset-4">
                  Resource Utilization %
                </span>
              </DefaultTooltipLazy>
            )}
          >
            <div className="grow flex gap-2 items-center">
              <span>5%</span>
              <Slider
                value={utilization}
                step={5}
                min={5}
                max={65}
                marks={true}
                valueLabelDisplay="auto"
                aria-label="Utilization"
                onChange={onUtilizationChange as unknown as (event: Event) => void}
              />
              <span>65%</span>
            </div>
          </InputRow>
          <InputRow title={'Application Servers'}>
            <>
              <IntegerInput
                id="workload-cpu-cores"
                label="vCPU Cores"
                value={workloadCores}
                onChange={onWorkloadCoresChange}
              />
              <IntegerInput
                id="workload-memory-gb"
                label="Memory GB"
                value={workloadMemory}
                onChange={onWorkloadMemoryChange}
              />
            </>
          </InputRow>
          <InputRow
            title={(
              <DefaultTooltipLazy title={'For example, PostgreSQL or MySQL'}>
                <span className="underline decoration-dotted decoration-black decoration-2 underline-offset-4">
                  Relational Databases
                </span>
              </DefaultTooltipLazy>
            )}
          >
            <>
              <IntegerInput
                id="postgres-cpu-cores"
                label="vCPU Cores"
                value={pgCores}
                onChange={onPGCoresChange}
              />
              <IntegerInput
                id="postgres-memory-gb"
                label="Memory GB"
                value={pgMemory}
                onChange={onPGMemoryChange}
              />
              <IntegerInput
                id="postgres-storage-gb"
                label="Storage GB"
                value={pgStorage}
                onChange={onPGStorageChange}
              />
            </>
          </InputRow>
          <InputRow
            title={(
              <DefaultTooltipLazy title={'For example, Redis or memcached'}>
                <span className="underline decoration-dotted decoration-black decoration-2 underline-offset-4">
                  Key-Value Databases
                </span>
              </DefaultTooltipLazy>
            )}
          >
            <>
              <IntegerInput
                id="kv-cpu-cores"
                label="vCPU Cores"
                value={kvCores}
                onChange={onKVCoresChange}
              />
              <IntegerInput
                id="kv-memory-gb"
                label="Memory GB"
                value={kvMemory}
                onChange={onKVMemoryChange}
              />
              <IntegerInput
                id="kv-storage-gb"
                label="Storage GB"
                value={kvStorage}
                onChange={onKVStorageChange}
              />
            </>

          </InputRow>
          <InputRow title={'Observability'}>
            <>
              <IntegerInput
                id="logs"
                label="GB Logs / Month"
                value={logs}
                onChange={onLogsChange}
              />
              <IntegerInput
                id="metrics"
                label="# of Metrics (Ks)"
                value={metrics}
                onChange={onMetricsChange}
              />
              <IntegerInput
                id="spans"
                label="# of Tracing Spans / Month (Ms)"
                value={spans}
                onChange={onSpansChange}
              />
            </>

          </InputRow>
          <InputRow
            title={(
              <DefaultTooltipLazy
                title={'CPU-minutes are the number of minutes a CI/CD pipeline is running multiplied by the number of provisioned vCPUs. For example, in standard GHA this would be 2 / minute.'}
              >
                <span className="underline decoration-dotted decoration-black decoration-2 underline-offset-4">
                  CI / CD
                </span>
              </DefaultTooltipLazy>
            )}
          >
            <IntegerInput
              id="cicd-minutes"
              label="CPU-Minutes / Month"
              value={cicdMinutes}
              onChange={onCICDMinutesChange}
            />
          </InputRow>
        </div>
        <SavingsTable
          workloadCores={workloadCores}
          workloadMemory={workloadMemory}
          pgCores={pgCores}
          pgMemory={pgMemory}
          pgStorage={pgStorage}
          kvCores={kvCores}
          kvMemory={kvMemory}
          kvStorage={kvStorage}
          utilization={utilization}
          egressTraffic={egressTraffic}
          vpcCount={vpcCount}
          interAZTraffic={interAZTraffic}
          logs={logs}
          spans={spans}
          metrics={metrics}
          employeeCount={employeeCount}
          developerCount={developerCount}
          cicdMinutes={cicdMinutes}
          laborCostHourly={lablorCostHourly}
          copyLinkToClipboard={copyLinkToClipboard}
        />
        <Snackbar
          open={snackbarOpen}
          autoHideDuration={3000}
          onClose={closeSnackbar}
          message="Copied stateful link to clipboard"
        />
      </div>

    </div>
  )
}
