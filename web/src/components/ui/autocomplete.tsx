"use client"

/**
 * Free-text input with suggestions (Base UI Autocomplete), styled to match shadcn's
 * base-nova Combobox. Unlike Combobox, the value can be anything the user types.
 */
import * as React from "react"
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete"
import { ChevronDownIcon } from "lucide-react"

import { cn, overlayRoot } from "@/lib/utils"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"

const Autocomplete = AutocompletePrimitive.Root

function AutocompleteInput({
  className,
  showTrigger = true,
  ...props
}: AutocompletePrimitive.Input.Props & { showTrigger?: boolean }) {
  return (
    <InputGroup className={cn("w-full", className)}>
      <AutocompletePrimitive.Input data-slot="autocomplete-input" render={<InputGroupInput />} {...props} />
      {showTrigger && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            variant="ghost"
            aria-label="Show suggestions"
            render={<AutocompletePrimitive.Trigger />}
            className="data-pressed:bg-transparent"
          >
            <ChevronDownIcon className="pointer-events-none text-muted-foreground" />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}

function AutocompleteContent({
  className,
  side = "bottom",
  sideOffset = 6,
  align = "start",
  ...props
}: AutocompletePrimitive.Popup.Props &
  Pick<AutocompletePrimitive.Positioner.Props, "side" | "align" | "sideOffset">) {
  return (
    <AutocompletePrimitive.Portal container={overlayRoot()}>
      <AutocompletePrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        <AutocompletePrimitive.Popup
          data-slot="autocomplete-content"
          className={cn(
            "group/autocomplete-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  )
}

function AutocompleteList({ className, ...props }: AutocompletePrimitive.List.Props) {
  return (
    <AutocompletePrimitive.List
      data-slot="autocomplete-list"
      className={cn("max-h-72 scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0", className)}
      {...props}
    />
  )
}

function AutocompleteItem({ className, ...props }: AutocompletePrimitive.Item.Props) {
  return (
    <AutocompletePrimitive.Item
      data-slot="autocomplete-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function AutocompleteEmpty({ className, ...props }: AutocompletePrimitive.Empty.Props) {
  return (
    <AutocompletePrimitive.Empty
      data-slot="autocomplete-empty"
      className={cn("px-3 py-2 text-sm text-muted-foreground empty:hidden", className)}
      {...props}
    />
  )
}

export { Autocomplete, AutocompleteInput, AutocompleteContent, AutocompleteList, AutocompleteItem, AutocompleteEmpty }
