import 'reflect-metadata'
import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import './drawing.css'

// Mounts the single-page toolbox into the Vite host document.
createApp(App).use(ui).mount('#app')
