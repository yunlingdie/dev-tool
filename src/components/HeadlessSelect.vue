<script setup lang="ts">
import { computed } from 'vue'
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/vue'
import { Check, ChevronDown } from '@lucide/vue'

export type HeadlessSelectOption = {
  label: string
  value: string
}

const props = defineProps<{
  id?: string
  modelValue: string
  options: HeadlessSelectOption[]
  ariaLabel?: string
}>()

const emit = defineEmits<{
  change: [value: string]
}>()

/** Proxies Headless UI selection changes to the parent-owned value. */
const selectedValue = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('change', value),
})

/** Resolves the current display label while keeping an empty option list safe to render. */
const selectedOption = computed(() => {
  // A stale stored value falls back to the first declared option until the parent updates it.
  return props.options.find((option) => option.value === props.modelValue) ?? props.options[0]
})
</script>

<template>
  <Listbox v-model="selectedValue">
    <div class="headless-select">
      <ListboxButton
        :id="id"
        class="headless-select-button"
        :aria-label="ariaLabel"
      >
        <span>{{ selectedOption?.label }}</span>
        <ChevronDown :size="15" aria-hidden="true" />
      </ListboxButton>

      <transition
        enter-active-class="headless-select-transition"
        enter-from-class="headless-select-transition-from"
        leave-active-class="headless-select-transition"
        leave-to-class="headless-select-transition-from"
      >
        <ListboxOptions class="headless-select-options">
          <ListboxOption
            v-for="option in options"
            :key="option.value"
            v-slot="{ active, selected }"
            :value="option.value"
            as="template"
          >
            <li
              class="headless-select-option"
              :class="{
                'headless-select-option--active': active,
                'headless-select-option--selected': selected,
              }"
            >
              <span>{{ option.label }}</span>
              <!-- The checkmark distinguishes the committed value from keyboard hover. -->
              <Check v-if="selected" :size="15" aria-hidden="true" />
            </li>
          </ListboxOption>
        </ListboxOptions>
      </transition>
    </div>
  </Listbox>
</template>
