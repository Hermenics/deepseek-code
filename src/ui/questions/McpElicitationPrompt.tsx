import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import useInput from '../../ink/hooks/use-input.js'
import type { InputEvent, Key } from '../../ink/events/input-event.js'
import type { EventEmitter } from '../../ink/events/emitter.js'
import Box from '../../ink/components/Box.js'
import Text from '../../ink/components/Text.js'
import type { Agent } from '../../agent/agent.js'
import type {
  McpElicitationContent,
  McpElicitationHandler,
  McpElicitationRequest,
  McpElicitationResponse,
  McpElicitationSchema,
} from '../../agent/mcpElicitation.js'
import { useThemeColors } from '../design-system/ThemeProvider.js'

export interface McpElicitationPromptState {
  id: number
  request: McpElicitationRequest
  resolve(response: McpElicitationResponse): void
}

interface QueueEntry extends McpElicitationPromptState {
  signal: AbortSignal
  settled: boolean
  onAbort(): void
  complete(response: McpElicitationResponse): void
}

/** Registers a FIFO prompt queue whose entries are settled only by their own signal or response. */
export function bindMcpElicitationPrompt(
  agent: Pick<Agent, 'setMcpElicitationHandler'>,
  publish: (state: McpElicitationPromptState | null) => void,
): () => void {
  const queue: QueueEntry[] = []
  let active: QueueEntry | null = null
  let disposed = false
  let nextId = 1

  const publishNext = () => {
    if (disposed || active) return
    while (queue.length > 0) {
      const candidate = queue.shift()!
      if (candidate.settled) continue
      if (candidate.signal.aborted) {
        candidate.resolve({ action: 'cancel' })
        continue
      }
      active = candidate
      publish(candidate)
      return
    }
    publish(null)
  }

  const settle = (entry: QueueEntry, response: McpElicitationResponse) => {
    if (entry.settled) return
    entry.settled = true
    entry.signal.removeEventListener('abort', entry.onAbort)
    const wasActive = active === entry
    if (wasActive) active = null
    else {
      const index = queue.indexOf(entry)
      if (index >= 0) queue.splice(index, 1)
    }
    entry.complete(response)
    if (wasActive) publishNext()
  }

  const handler: McpElicitationHandler = (request, signal) => new Promise(resolve => {
    if (disposed || signal.aborted) {
      resolve({ action: 'cancel' })
      return
    }

    const entry = {
      id: nextId++,
      request,
      signal,
      settled: false,
      onAbort: () => {},
      complete: resolve,
      resolve: (response: McpElicitationResponse) => settle(entry, response),
    } satisfies QueueEntry
    entry.onAbort = () => settle(entry, { action: 'cancel' })
    signal.addEventListener('abort', entry.onAbort, { once: true })
    if (signal.aborted) {
      settle(entry, { action: 'cancel' })
      return
    }
    queue.push(entry)
    publishNext()
  })

  agent.setMcpElicitationHandler(handler)
  return () => {
    if (disposed) return
    disposed = true
    agent.setMcpElicitationHandler(null)
    const outstanding = [...(active ? [active] : []), ...queue]
    active = null
    queue.length = 0
    publish(null)
    for (const entry of outstanding) {
      if (entry.settled) continue
      entry.settled = true
      entry.signal.removeEventListener('abort', entry.onAbort)
      entry.complete({ action: 'cancel' })
    }
  }
}

type FieldSchema = McpElicitationSchema['properties'][string]
type DraftValue = string | string[] | undefined
type FormDraft = Record<string, DraftValue>
type Option = { value: string; label: string }
type Action = 'accept' | 'decline' | 'cancel'
export type McpElicitationInputHandler = (input: string, key: Key) => void

/** Gives the active MCP form first access to keyboard events while preserving a covered screen's React state. */
export function bindMcpElicitationInput(
  eventEmitter: Pick<EventEmitter, 'prependListener' | 'removeListener'>,
  inputHandlerRef: { current: McpElicitationInputHandler | null },
): () => void {
  const handleInput = (event: InputEvent) => {
    event.stopImmediatePropagation()
    inputHandlerRef.current?.(event.input, event.key)
  }
  eventEmitter.prependListener('input', handleInput)
  return () => eventEmitter.removeListener('input', handleInput)
}

function rule() {
  return '─'.repeat(Math.max(20, Math.min(process.stdout.columns ?? 80, 160)))
}

/** Removes terminal control sequences while preserving ordinary line breaks and tabs. */
function safeDisplayText(value: string): string {
  return value
    .replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '')
    .replace(/[\x00-\x08\x0B-\x0D\x0E-\x1F\x7F-\x9F\u202A-\u202E\u2066-\u2069]/g, ' ')
}

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function isCredentialLikeRequest(request: McpElicitationRequest): boolean {
  const credentialText = /password|pass[\s_-]?(?:code|phrase)|secret|(?:access|refresh|bearer|session)?[\s_-]?token|credential|api[\s_-]?key|private[\s_-]?key|credit[\s_-]?card|cvv|cvc|ssn|social[\s_-]?security|(?:one[\s_-]?time|verification|authentication)[\s_-]?(?:password|passcode|code|token)|(?:mfa|2fa|multi[\s_-]?factor|two[\s_-]?factor)[\s_-]?(?:(?:recovery|backup|verification|authentication|authenticator|auth|one[\s_-]?time)[\s_-]?)?(?:password|passcode|code|token|otp)|(?:recovery|backup)[\s_-]?(?:code|token)[\s_-]?(?:for[\s_-]?)?(?:mfa|2fa|multi[\s_-]?factor|two[\s_-]?factor)|(?:code|passcode|token)[\s_-]?(?:for[\s_-]?)?(?:mfa|2fa|multi[\s_-]?factor|two[\s_-]?factor)|authenticator|\botp\b|\bpin\b/i
  const fieldText = Object.entries(request.requestedSchema.properties)
    .flatMap(([name, schema]) => [name, schema.title ?? '', schema.description ?? ''])
  return credentialText.test([request.message, ...fieldText].join(' '))
}

function titleFor(name: string, schema: FieldSchema): string {
  return safeDisplayText(schema.title || name)
}

function fieldOptions(schema: FieldSchema): Option[] {
  if (schema.type === 'string') {
    if ('enum' in schema && Array.isArray(schema.enum)) {
      return schema.enum.map((value, index) => ({ value, label: ('enumNames' in schema ? schema.enumNames?.[index] : undefined) ?? value }))
    }
    if ('oneOf' in schema && Array.isArray(schema.oneOf)) {
      return schema.oneOf.map(option => ({ value: option.const, label: option.title }))
    }
  }
  if (schema.type === 'array') {
    if ('enum' in schema.items && Array.isArray(schema.items.enum)) {
      return schema.items.enum.map(value => ({ value, label: value }))
    }
    if ('anyOf' in schema.items && Array.isArray(schema.items.anyOf)) {
      return schema.items.anyOf.map(option => ({ value: option.const, label: option.title }))
    }
  }
  return []
}

function createInitialDraft(fields: [string, FieldSchema][]): FormDraft {
  const draft = emptyRecord<DraftValue>()
  for (const [name, schema] of fields) {
    if (schema.default === undefined) continue
    draft[name] = Array.isArray(schema.default) ? [...schema.default] : String(schema.default)
  }
  return draft
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match || !validDate(match[1]!)) return false
  const hour = Number(match[2])
  const minute = Number(match[3])
  const second = Number(match[4])
  const offsetHour = Number(match[6] ?? 0)
  const offsetMinute = Number(match[7] ?? 0)
  return hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59 && Number.isFinite(Date.parse(value))
}

function validEmail(value: string): boolean {
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  const atom = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/
  if (local.length > 64 || local.split('.').some(part => !part || !atom.test(part))) return false
  if (!domain || domain.length > 253) return false
  const labels = domain.split('.')
  return labels.length >= 2 && labels.every(label => label.length > 0 && label.length <= 63 &&
    /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u.test(label))
}

function validFormat(value: string, format: string | undefined): boolean {
  if (format === undefined) return true
  if (format === 'date') return validDate(value)
  if (format === 'date-time') return validDateTime(value)
  if (format === 'email') return validEmail(value)
  if (format === 'uri') {
    try { return new URL(value).protocol !== '' }
    catch { return false }
  }
  return false
}

function validateDraft(fields: [string, FieldSchema][], required: string[], draft: FormDraft) {
  const content = emptyRecord<string | number | boolean | string[]>()
  const errors = emptyRecord<string>()
  for (const [name, schema] of fields) {
    const raw = draft[name]
    const isRequired = required.includes(name)
    const numericField = schema.type === 'number' || schema.type === 'integer'
    const missing = raw === undefined || (numericField && typeof raw === 'string' && raw.trim() === '')
    if (missing) {
      if (isRequired) errors[name] = 'This field is required.'
      continue
    }

    if (schema.type === 'string') {
      if (typeof raw !== 'string') { errors[name] = 'Enter text for this field.'; continue }
      const options = fieldOptions(schema)
      if (options.length > 0 && !options.some(option => option.value === raw)) {
        errors[name] = 'Choose one of the listed options.'
        continue
      }
      if ('minLength' in schema && typeof schema.minLength === 'number' && [...raw].length < schema.minLength) {
        errors[name] = `Enter at least ${schema.minLength} characters.`
        continue
      }
      if ('maxLength' in schema && typeof schema.maxLength === 'number' && [...raw].length > schema.maxLength) {
        errors[name] = `Enter no more than ${schema.maxLength} characters.`
        continue
      }
      if ('format' in schema && !validFormat(raw, schema.format)) {
        errors[name] = `Enter a valid ${schema.format} value.`
        continue
      }
      content[name] = raw
      continue
    }

    if (schema.type === 'boolean') {
      if (raw !== 'true' && raw !== 'false') { errors[name] = 'Choose Yes or No.'; continue }
      content[name] = raw === 'true'
      continue
    }

    if (schema.type === 'number' || schema.type === 'integer') {
      if (typeof raw !== 'string') { errors[name] = 'Enter a number.'; continue }
      const number = Number(raw)
      if (!Number.isFinite(number) || (schema.type === 'integer' && !Number.isSafeInteger(number))) {
        errors[name] = schema.type === 'integer' ? 'Enter a whole number.' : 'Enter a valid number.'
        continue
      }
      if (typeof schema.minimum === 'number' && number < schema.minimum) {
        errors[name] = `Use a value of at least ${schema.minimum}.`
        continue
      }
      if (typeof schema.maximum === 'number' && number > schema.maximum) {
        errors[name] = `Use a value no greater than ${schema.maximum}.`
        continue
      }
      content[name] = number
      continue
    }

    if (schema.type === 'array') {
      const options = fieldOptions(schema)
      if (!Array.isArray(raw) || raw.some(value => !options.some(option => option.value === value))) {
        errors[name] = 'Choose only listed options.'
        continue
      }
      if (typeof schema.minItems === 'number' && raw.length < schema.minItems) {
        errors[name] = `Choose at least ${schema.minItems} option${schema.minItems === 1 ? '' : 's'}.`
        continue
      }
      if (typeof schema.maxItems === 'number' && raw.length > schema.maxItems) {
        errors[name] = `Choose no more than ${schema.maxItems} option${schema.maxItems === 1 ? '' : 's'}.`
        continue
      }
      content[name] = [...raw]
    }
  }
  return { content: Object.fromEntries(Object.entries(content)) as McpElicitationContent, errors }
}

function displayValue(schema: FieldSchema, value: DraftValue): string {
  if (value === undefined) return 'Not set'
  if (Array.isArray(value)) {
    const labels = fieldOptions(schema).filter(option => value.includes(option.value)).map(option => safeDisplayText(option.label))
    return labels.length > 0 ? labels.join(', ') : 'No options selected'
  }
  if (schema.type === 'boolean') return value === 'true' ? 'Yes' : value === 'false' ? 'No' : 'Not set'
  if (schema.type === 'string') {
    const option = fieldOptions(schema).find(candidate => candidate.value === value)
    return safeDisplayText(option?.label ?? value) || '(empty)'
  }
  return safeDisplayText(value) || '(empty)'
}

interface Props {
  request: McpElicitationRequest
  requestId?: number
  onAccept(content: McpElicitationContent): void
  onDecline(): void
  onCancel(): void
  active?: boolean
  inputHandlerRef?: { current: McpElicitationInputHandler | null }
}

/** A local-only reviewable MCP form. Server-provided text is rendered as plain, sanitized text. */
export function McpElicitationPrompt({ request, requestId, onAccept, onDecline, onCancel, active = true, inputHandlerRef }: Props) {
  const colors = useThemeColors()
  const fields = useMemo(() => Object.entries(request.requestedSchema.properties) as [string, FieldSchema][], [request.requestedSchema])
  const unsafeRequest = useMemo(() => isCredentialLikeRequest(request), [request])
  const [values, setValues] = useState<FormDraft>(() => unsafeRequest ? emptyRecord<DraftValue>() : createInitialDraft(fields))
  const [fieldIndex, setFieldIndex] = useState(0)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [review, setReview] = useState(unsafeRequest)
  const [actionIndex, setActionIndex] = useState(0)
  const [choiceIndex, setChoiceIndex] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>(() => emptyRecord<string>())
  const submitted = useRef(false)
  useLayoutEffect(() => {
    setValues(unsafeRequest ? emptyRecord<DraftValue>() : createInitialDraft(fields))
    setFieldIndex(0)
    setReviewIndex(0)
    setReview(unsafeRequest)
    setActionIndex(0)
    setChoiceIndex(0)
    setErrors(emptyRecord<string>())
    submitted.current = false
  }, [requestId, request, fields, unsafeRequest])
  const activeField = fields[fieldIndex]
  const activeName = activeField?.[0]
  const activeSchema = activeField?.[1]
  const options = activeSchema ? fieldOptions(activeSchema) : []
  const required = request.requestedSchema.required ?? []
  const actions: { action: Action; label: string }[] = unsafeRequest
    ? [{ action: 'decline', label: 'Decline' }, { action: 'cancel', label: 'Cancel request' }]
    : [
        { action: 'accept', label: 'Accept and send' },
        { action: 'decline', label: 'Decline' },
        { action: 'cancel', label: 'Cancel request' },
      ]
  const reviewedField = fields[reviewIndex]

  const finish = (action: Action, content?: McpElicitationContent) => {
    if (submitted.current) return
    submitted.current = true
    if (action === 'accept' && content) onAccept(content)
    else if (action === 'decline') onDecline()
    else onCancel()
  }

  const updateValue = (name: string, value: DraftValue) => {
    setValues(current => {
      const next = Object.assign(emptyRecord<DraftValue>(), current)
      next[name] = value
      return next
    })
    setErrors(current => {
      if (!Object.prototype.hasOwnProperty.call(current, name)) return current
      const next = Object.assign(emptyRecord<string>(), current)
      delete next[name]
      return next
    })
  }

  const moveField = (offset: number) => {
    if (fields.length === 0) { setReview(true); return }
    const next = fieldIndex + offset
    if (next < 0) return
    if (next >= fields.length) { setReview(true); return }
    setFieldIndex(next)
    setChoiceIndex(0)
  }

  const activateAction = () => {
    const selected = actions[actionIndex]!
    if (selected.action !== 'accept') { finish(selected.action); return }
    const result = validateDraft(fields, required, values)
    if (Object.keys(result.errors).length > 0) {
      setErrors(result.errors)
      const firstInvalid = fields.findIndex(([name]) => Object.prototype.hasOwnProperty.call(result.errors, name))
      if (firstInvalid >= 0) setReviewIndex(firstInvalid)
      return
    }
    finish('accept', result.content)
  }

  const handleInput: McpElicitationInputHandler = (input, key) => {
    if (!active) return
    if (key.escape || (key.ctrl && input === 'c')) { finish('cancel'); return }

    if (review) {
      if (key.tab) {
        const firstInvalid = fields.findIndex(([name]) => Object.prototype.hasOwnProperty.call(errors, name))
        setFieldIndex(firstInvalid >= 0 ? firstInvalid : Math.min(reviewIndex, Math.max(0, fields.length - 1)))
        setChoiceIndex(0)
        setReview(false)
        return
      }
      if (key.leftArrow) { setActionIndex(index => (index + actions.length - 1) % actions.length); return }
      if (key.rightArrow) { setActionIndex(index => (index + 1) % actions.length); return }
      if (key.upArrow) { setReviewIndex(index => Math.max(0, index - 1)); return }
      if (key.downArrow) { setReviewIndex(index => Math.min(Math.max(0, fields.length - 1), index + 1)); return }
      if (key.return) activateAction()
      return
    }

    if (key.tab) { setReviewIndex(Math.min(fieldIndex, Math.max(0, fields.length - 1))); setReview(true); return }
    if (!activeField || !activeSchema) {
      if (key.return) setReview(true)
      return
    }
    if (key.upArrow) { moveField(-1); return }
    if (key.downArrow) { moveField(1); return }
    if (key.return) {
      if (activeSchema.type === 'array' && values[activeName] === undefined) updateValue(activeName, [])
      moveField(1)
      return
    }

    const current = values[activeName]
    if (activeSchema.type === 'string' && options.length > 0) {
      if (key.backspace || key.delete) { updateValue(activeName, undefined); return }
      if (key.leftArrow || key.rightArrow) {
        const currentValue = typeof current === 'string' ? options.findIndex(option => option.value === current) : -1
        const offset = key.leftArrow ? -1 : 1
        const currentIndex = currentValue >= 0 ? currentValue : 0
        const selected = options[(currentIndex + offset + options.length) % options.length]!
        updateValue(activeName, selected.value)
        return
      }
      if (/^[1-9]$/.test(input) && Number(input) <= options.length) {
        updateValue(activeName, options[Number(input) - 1]!.value)
        return
      }
    }

    if (activeSchema.type === 'boolean') {
      if (key.backspace || key.delete) { updateValue(activeName, undefined); return }
      if (key.leftArrow || input.toLowerCase() === 'n') { updateValue(activeName, 'false'); return }
      if (key.rightArrow || input.toLowerCase() === 'y') { updateValue(activeName, 'true'); return }
      if (input === ' ') { updateValue(activeName, current === 'true' ? 'false' : 'true'); return }
    }

    if (activeSchema.type === 'array') {
      const selected = Array.isArray(current) ? current : []
      let optionIndex = choiceIndex
      if (/^[1-9]$/.test(input) && Number(input) <= options.length) optionIndex = Number(input) - 1
      else if (key.leftArrow) { setChoiceIndex(index => (index - 1 + options.length) % Math.max(1, options.length)); return }
      else if (key.rightArrow) { setChoiceIndex(index => (index + 1) % Math.max(1, options.length)); return }
      else if (input !== ' ') return
      const value = options[optionIndex]?.value
      if (value === undefined) return
      const next = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value]
      updateValue(activeName, next)
      setChoiceIndex((optionIndex + 1) % Math.max(1, options.length))
      return
    }

    if (activeSchema.type === 'string' || activeSchema.type === 'number' || activeSchema.type === 'integer') {
      if (key.backspace || key.delete) {
        updateValue(activeName, typeof current === 'string' ? [...current].slice(0, -1).join('') : '')
        return
      }
      if (!key.ctrl && !key.meta && input) {
        const accepted = activeSchema.type === 'string'
          ? input
          : input.replace(activeSchema.type === 'integer' ? /[^0-9+-]/g : /[^0-9+\-.eE]/g, '')
        if (accepted) updateValue(activeName, `${typeof current === 'string' ? current : ''}${accepted}`)
      }
    }
  }
  useLayoutEffect(() => {
    if (!inputHandlerRef) return
    inputHandlerRef.current = handleInput
    return () => {
      if (inputHandlerRef.current === handleInput) inputHandlerRef.current = null
    }
  }, [inputHandlerRef, handleInput])
  useInput(inputHandlerRef ? () => {} : handleInput)

  const ruleText = <Text color={colors.rule}>{rule()}</Text>
  const safeServer = safeDisplayText(request.serverName)
  const safeMessage = safeDisplayText(request.message)

  return (
    <Box flexDirection="column" marginTop={1}>
      {ruleText}
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text color={colors.warning}>◇</Text>
        <Text bold>MCP form request</Text>
        <Text color={colors.textDim}>from {safeServer}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>{safeMessage}</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={colors.textDim}>Do not enter passwords, tokens, or other credentials.</Text>
      </Box>

      {unsafeRequest ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={colors.error}>This request may ask for an authentication credential. No values will be collected.</Text>
          <Box flexDirection="row" gap={2} marginTop={1}>
            {actions.map((item, index) => (
              <Text key={item.action} bold={index === actionIndex} color={index === actionIndex ? colors.warning : colors.textDim}>
                {index === actionIndex ? '❯ ' : '  '}{item.label}
              </Text>
            ))}
          </Box>
          <Text color={colors.textDim}>←→ choose action · Enter confirm · Esc cancel</Text>
        </Box>
      ) : review ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={colors.h2}>Review before sending</Text>
          {reviewedField ? (
            <Box flexDirection="column" marginTop={1}>
              <Box flexDirection="row" gap={1}>
                <Text color={colors.primary}>{reviewIndex + 1}/{fields.length}</Text>
                <Text bold>{titleFor(reviewedField[0], reviewedField[1])}</Text>
              </Box>
              <Text>{displayValue(reviewedField[1], values[reviewedField[0]])}</Text>
              {errors[reviewedField[0]] && <Text color={colors.error}>{errors[reviewedField[0]]}</Text>}
            </Box>
          ) : <Text color={colors.textDim}>No fields requested.</Text>}
          {Object.keys(errors).length > 0 && (
            <Text color={colors.error}>{Object.keys(errors).length} field(s) need attention. Press Tab to edit.</Text>
          )}
          <Box flexDirection="row" gap={2} marginTop={1}>
            {actions.map((item, index) => (
              <Text key={item.action} bold={index === actionIndex} color={index === actionIndex ? (item.action === 'accept' ? colors.success : item.action === 'decline' ? colors.warning : colors.textDim) : colors.textDim}>
                {index === actionIndex ? '❯ ' : '  '}{item.label}
              </Text>
            ))}
          </Box>
          <Text color={colors.textDim}>↑↓ review fields · ←→ choose action · Enter confirm · Tab edit · Esc cancel</Text>
        </Box>
      ) : activeField ? (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Text color={colors.primary}>{fieldIndex + 1}/{fields.length}</Text>
            <Text bold>{titleFor(activeName!, activeSchema!)}</Text>
            {required.includes(activeName!) && <Text color={colors.warning}>required</Text>}
          </Box>
          {activeSchema!.description && <Text color={colors.textDim}>{safeDisplayText(activeSchema!.description)}</Text>}
          {activeSchema!.type === 'string' && options.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              {options.map((option, index) => {
                const selected = values[activeName!] === option.value
                const active = selected || (!options.some(item => item.value === values[activeName!]) && index === 0)
                return <Text key={option.value} color={active ? colors.primary : colors.textDim}>{active ? '❯' : ' '} {index + 1}. {safeDisplayText(option.label)}{selected ? ' ✓' : ''}</Text>
              })}
            </Box>
          ) : activeSchema!.type === 'boolean' ? (
            <Box flexDirection="row" gap={2} marginTop={1}>
              <Text color={values[activeName!] === 'true' ? colors.primary : colors.textDim}>{values[activeName!] === 'true' ? '❯ ' : '  '}Yes (y/right)</Text>
              <Text color={values[activeName!] === 'false' ? colors.primary : colors.textDim}>{values[activeName!] === 'false' ? '❯ ' : '  '}No (n/left)</Text>
            </Box>
          ) : activeSchema!.type === 'array' ? (
            <Box flexDirection="column" marginTop={1}>
              {options.map((option, index) => {
                const selected = Array.isArray(values[activeName!]) && (values[activeName!] as string[]).includes(option.value)
                return <Text key={option.value} color={index === choiceIndex ? colors.primary : colors.textDim}>{index === choiceIndex ? '❯' : ' '} {index + 1}. [{selected ? 'x' : ' '}] {safeDisplayText(option.label)}</Text>
              })}
              {typeof activeSchema!.minItems === 'number' && <Text color={colors.textDim}>Choose at least {activeSchema!.minItems}.</Text>}
              {typeof activeSchema!.maxItems === 'number' && <Text color={colors.textDim}>Choose up to {activeSchema!.maxItems}.</Text>}
            </Box>
          ) : (
            <Box flexDirection="row" gap={1} marginTop={1}>
              <Text color={colors.primary}>❯</Text>
              {values[activeName!] ? (
                <Text>{safeDisplayText(Array.isArray(values[activeName!]) ? (values[activeName!] as string[]).join(', ') : values[activeName!] as string)}<Text color={colors.primary}>█</Text></Text>
              ) : <Text color={colors.textDim}>{activeSchema!.type === 'number' || activeSchema!.type === 'integer' ? 'Type a number' : `Type ${'format' in activeSchema! ? activeSchema!.format ?? 'text' : 'text'}`}</Text>}
            </Box>
          )}
          {errors[activeName!] && <Text color={colors.error}>{errors[activeName!]}</Text>}
          <Text color={colors.textDim}>
            {activeSchema!.type === 'string' && options.length > 0 ? '←→ or number to choose · Backspace clears optional value' : activeSchema!.type === 'boolean' ? 'y/n or ←→ to choose · Backspace clears optional value' : activeSchema!.type === 'array' ? 'Space or number to toggle · Enter to finish' : 'Type to edit · Backspace to delete'}
            {' · ↑↓ fields · Enter next · Tab review · Esc cancel'}
          </Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <Text color={colors.textDim}>No fields requested. Press Tab to review.</Text>
        </Box>
      )}
      {ruleText}
    </Box>
  )
}
