"use client"
import * as React from "react"

const TOAST_LIMIT = 1
const TOAST_REMOVE_DELAY = 1000000

type ToasterToast = any // Using any for stub brevity, normally fully typed

const memoryState = { toasts: [] } as { toasts: ToasterToast[] }
let count = 0

function genId() {
  count = (count + 1) % Number.MAX_VALUE
  return count.toString()
}

export function toast({ ...props }: any) {
  const id = genId()
  const update = (props: ToasterToast) => {}
  const dismiss = () => {}
  return { id, dismiss, update }
}

export function useToast() {
  const [state, setState] = React.useState<{ toasts: ToasterToast[] }>(memoryState)
  return { ...state, toast, dismiss: (toastId?: string) => {} }
}
