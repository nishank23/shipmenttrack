export const standardSpring = { type: 'spring', stiffness: 320, damping: 28 }

export const layoutTransition = { layout: standardSpring }

export const pageVariants = {
  initial: { opacity: 0, y: 10 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { y: standardSpring, opacity: { duration: 0.18, ease: 'easeOut' } },
  },
  exit: { opacity: 0, y: -4, transition: { duration: 0.1, ease: 'easeIn' } },
}

const animatedPage = {
  variants: pageVariants,
  initial: 'initial',
  animate: 'enter',
  exit: 'exit',
}

const stillPage = { initial: false, animate: { opacity: 1, y: 0 }, transition: { duration: 0 } }

export function getPageMotion(reducedMotion) {
  return reducedMotion ? stillPage : animatedPage
}

export const staggerContainer = {
  initial: {},
  enter: { transition: { staggerChildren: 0.045 } },
}

export const staggerItem = {
  initial: { opacity: 0, y: 6 },
  enter: { opacity: 1, y: 0, transition: standardSpring },
}

export const cardInteraction = {
  whileHover: { scale: 1.015 },
  whileTap: { scale: 0.985 },
  transition: standardSpring,
}
