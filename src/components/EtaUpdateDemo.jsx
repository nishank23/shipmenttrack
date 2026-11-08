import { useEffect, useRef, useState } from 'react'
import { Icon } from '@iconify/react'
import { carriers } from '../lib/carriers'

const sample = {
  carrier: 'MSC',
  reference: 'MEDU-EXAMPLE',
  previous: { label: 'Mar 12', iso: '2027-03-12' },
  updated: { label: 'Mar 15', iso: '2027-03-15' },
  difference: '3 days later',
}
const carrierNames = carriers.map(({ label }) => label).join(' / ')

function EtaUpdateDemo() {
  const scope = useRef(null)
  const replay = useRef(null)
  const [canReplay, setCanReplay] = useState(false)

  useEffect(() => {
    let disposed = false
    let media

    import('gsap').then(({ default: gsap }) => {
      if (disposed || !scope.current) return
      const element = scope.current
      media = gsap.matchMedia(element)
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const sequence = gsap.timeline({ paused: true, defaults: { ease: 'power2.out' } })
          .fromTo('[data-demo-line]', { scaleX: 0 }, { scaleX: 1, duration: 0.72, ease: 'power2.inOut' }, 0.18)
          .fromTo('[data-demo-date]', { opacity: 0.76, y: 6 }, { opacity: 1, y: 0, duration: 0.42 }, 0.58)
          .fromTo('[data-demo-delay]', { y: 4 }, { y: 0, duration: 0.36 }, 0.82)
          .fromTo('[data-demo-email]', { opacity: 0.74, y: 8 }, { opacity: 1, y: 0, duration: 0.48 }, 1.03)

        let visible = typeof IntersectionObserver === 'undefined'
        const syncPlayback = () => {
          if (!visible || document.hidden) sequence.pause()
          else if (sequence.progress() < 1) sequence.play()
        }
        const observer = !visible ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting
          syncPlayback()
        }, { threshold: 0.25 }) : null
        observer?.observe(element)
        document.addEventListener('visibilitychange', syncPlayback)
        syncPlayback()
        replay.current = () => {
          sequence.pause(0)
          syncPlayback()
        }
        setCanReplay(true)

        return () => {
          observer?.disconnect()
          document.removeEventListener('visibilitychange', syncPlayback)
          replay.current = null
        }
      })
    }).catch(() => {
      // The example stays readable if the optional animation chunk is unavailable.
    })

    return () => {
      disposed = true
      media?.revert()
    }
  }, [])

  return (
    <section className="lp-showcase" aria-labelledby="lp-showcase-title" ref={scope}>
      <header className="lp-demo-heading">
        <div>
          <h2 id="lp-showcase-title">When the ETA changes</h2>
          <p>Example shipment</p>
        </div>
        <button className="lp-demo-replay" type="button" hidden={!canReplay} onClick={() => replay.current?.()}>
          <Icon icon="solar:restart-linear" width="16" height="16" aria-hidden="true" />
          Replay<span className="sr-only"> ETA update example</span>
        </button>
      </header>

      <div className="lp-demo-flow">
        <div className="lp-demo-ticket">
          <div className="lp-demo-ticket__reference">
            <span>{sample.carrier} bill of lading</span>
            <strong>{sample.reference}</strong>
          </div>
          <div className="lp-demo-dates">
            <dl>
              <dt>Previous ETA</dt>
              <dd><time dateTime={sample.previous.iso}>{sample.previous.label}</time></dd>
            </dl>
            <div className="lp-demo-transfer" aria-hidden="true"><span data-demo-line /></div>
            <dl className="lp-demo-revised">
              <dt>Updated ETA</dt>
              <dd><time dateTime={sample.updated.iso} data-demo-date>{sample.updated.label}</time></dd>
              <dd className="lp-demo-delay" data-demo-delay>{sample.difference}</dd>
            </dl>
          </div>
        </div>

        <div className="lp-demo-email" data-demo-email>
          <div className="lp-demo-envelope" aria-hidden="true">
            <Icon icon="solar:letter-linear" width="21" height="21" />
          </div>
          <div>
            <p className="lp-demo-email__label">Email preview</p>
            <p className="lp-demo-email__subject">Shipment ETA updated</p>
            <p>New ETA: <time dateTime={sample.updated.iso}>{sample.updated.label}</time>.</p>
          </div>
        </div>
      </div>

      <footer className="lp-demo-carriers">
        <span>Supported carriers</span>
        <span>{carrierNames}</span>
      </footer>
    </section>
  )
}

export default EtaUpdateDemo
