import { useEffect } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

export { gsap, ScrollTrigger }

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * Lenis is the app's only smooth-scroll engine. It is driven by GSAP's ticker
 * so ScrollTrigger and Lenis share one clock, and it is skipped entirely when
 * the visitor prefers reduced motion.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) {
      return undefined
    }

    const lenis = new Lenis({ duration: 1.1, smoothWheel: true })
    const onTick = (time) => lenis.raf(time * 1000)

    lenis.on('scroll', ScrollTrigger.update)
    gsap.ticker.add(onTick)
    gsap.ticker.lagSmoothing(0)

    // Re-measure once fonts and media have settled.
    let active = true
    const refresh = () => {
      if (active) ScrollTrigger.refresh()
    }
    document.fonts?.ready.then(refresh).catch(() => {})
    window.addEventListener('load', refresh)

    return () => {
      active = false
      window.removeEventListener('load', refresh)
      gsap.ticker.remove(onTick)
      lenis.destroy()
    }
  }, [])
}
