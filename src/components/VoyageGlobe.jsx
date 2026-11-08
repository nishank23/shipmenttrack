import { useEffect, useRef, useState } from 'react'

/**
 * A dotted globe that traces one voyage. Land dots come from a public-domain
 * NASA land mask (public/globe/land-mask.png); the route is a set of great-
 * circle legs lifted off the surface. `progress.value` (0 to 1) is driven by
 * the parent's GSAP timeline and read on each frame.
 *
 * Three.js loads on demand. Rendering pauses offscreen and in hidden tabs,
 * the pixel ratio is capped, nothing is allocated per frame, and everything
 * is disposed on unmount. Without WebGL, or under reduced motion, the static
 * fallback (children) is shown instead.
 */
const MASK_URL = '/globe/land-mask.png'
const DOT_COUNT = 26000
const RADIUS = 1

function latLonToXYZ(lat, lon, radius, target) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  target[0] = -radius * Math.sin(phi) * Math.cos(theta)
  target[1] = radius * Math.cos(phi)
  target[2] = radius * Math.sin(phi) * Math.sin(theta)
  return target
}

function loadMask() {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d', { willReadFrequently: true })
      context.drawImage(image, 0, 0)
      resolve({ data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height })
    }
    image.onerror = reject
    image.src = MASK_URL
  })
}

function canRunWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function VoyageGlobe({ stops, progress, focus, className = '', children }) {
  const hostRef = useRef(null)
  const labelRefs = useRef([])
  const [mode, setMode] = useState('loading')

  useEffect(() => {
    const host = hostRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!host || reduced || !canRunWebGL()) {
      setMode('fallback')
      return undefined
    }

    let disposed = false
    let cleanup = () => {}

    Promise.all([import('three'), loadMask()])
      .then(([THREE, mask]) => {
        if (disposed) return

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
        renderer.setClearColor(0x000000, 0)
        host.prepend(renderer.domElement)
        renderer.domElement.setAttribute('aria-hidden', 'true')

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20)
        camera.position.set(0, 0, 5.2)

        const globe = new THREE.Group()
        scene.add(globe)

        // Face the voyage towards the camera with north kept up: yaw the focus
        // longitude to the front, then pitch its latitude to the centre.
        const yaw = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -Math.PI / 2 - (focus.lon * Math.PI) / 180,
        )
        const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (focus.lat * Math.PI) / 180)
        const baseQuaternion = pitch.multiply(yaw)
        globe.quaternion.copy(baseQuaternion)

        // Body: a dark sphere so the far side's dots never show through.
        const bodyGeometry = new THREE.SphereGeometry(RADIUS * 0.995, 64, 64)
        const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x0c1526 })
        globe.add(new THREE.Mesh(bodyGeometry, bodyMaterial))

        // Land dots on a Fibonacci lattice, kept where the mask says land.
        const positions = []
        const point = [0, 0, 0]
        const golden = Math.PI * (3 - Math.sqrt(5))
        for (let index = 0; index < DOT_COUNT; index += 1) {
          const y = 1 - (index / (DOT_COUNT - 1)) * 2
          const ring = Math.sqrt(1 - y * y)
          const angle = golden * index
          const x = Math.cos(angle) * ring
          const z = Math.sin(angle) * ring
          const lat = (Math.asin(y) * 180) / Math.PI
          const lon = (Math.atan2(z, -x) * 180) / Math.PI - 180
          const u = Math.floor((((lon + 180) % 360 + 360) % 360) / 360 * mask.width)
          const v = Math.floor(((90 - lat) / 180) * mask.height)
          const pixel = mask.data[(Math.min(v, mask.height - 1) * mask.width + Math.min(u, mask.width - 1)) * 4]
          if (pixel > 128) {
            latLonToXYZ(lat, lon, RADIUS, point)
            positions.push(point[0], point[1], point[2])
          }
        }
        const dotGeometry = new THREE.BufferGeometry()
        dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        const dotMaterial = new THREE.PointsMaterial({ color: 0x86a0c9, size: 0.014, sizeAttenuation: true })
        globe.add(new THREE.Points(dotGeometry, dotMaterial))

        // Route: great-circle legs, lifted in the middle, as one polyline.
        const SEGMENTS = 96
        const routePoints = []
        const a = new THREE.Vector3()
        const b = new THREE.Vector3()
        stops.slice(0, -1).forEach((stop, legIndex) => {
          const next = stops[legIndex + 1]
          a.set(...latLonToXYZ(stop.lat, stop.lon, 1, point)).normalize()
          b.set(...latLonToXYZ(next.lat, next.lon, 1, point)).normalize()
          const angle = a.angleTo(b)
          const lift = 0.04 + angle * 0.12
          for (let step = legIndex === 0 ? 0 : 1; step <= SEGMENTS; step += 1) {
            const t = step / SEGMENTS
            const s = Math.sin(angle)
            const wa = Math.sin((1 - t) * angle) / s
            const wb = Math.sin(t * angle) / s
            const p = new THREE.Vector3().addScaledVector(a, wa).addScaledVector(b, wb)
            p.normalize().multiplyScalar(RADIUS + 0.004 + Math.sin(Math.PI * t) * lift)
            routePoints.push(p)
          }
        })
        const routeGeometry = new THREE.BufferGeometry().setFromPoints(routePoints)
        const routeMaterial = new THREE.LineBasicMaterial({ color: 0x8bb9ff, transparent: true, opacity: 0.95 })
        const route = new THREE.Line(routeGeometry, routeMaterial)
        globe.add(route)

        const ghostMaterial = new THREE.LineBasicMaterial({ color: 0x8bb9ff, transparent: true, opacity: 0.18 })
        const ghostGeometry = routeGeometry.clone()
        const ghost = new THREE.Line(ghostGeometry, ghostMaterial)
        globe.add(ghost)

        // Ports and the vessel.
        const portGeometry = new THREE.SphereGeometry(0.014, 16, 16)
        const portMaterial = new THREE.MeshBasicMaterial({ color: 0xeef1f6 })
        const portVectors = stops.map((stop) => {
          const vector = new THREE.Vector3(...latLonToXYZ(stop.lat, stop.lon, RADIUS + 0.004, point))
          const mesh = new THREE.Mesh(portGeometry, portMaterial)
          mesh.position.copy(vector)
          globe.add(mesh)
          return vector
        })

        const vesselGeometry = new THREE.SphereGeometry(0.024, 20, 20)
        const vesselMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
        const vessel = new THREE.Mesh(vesselGeometry, vesselMaterial)
        globe.add(vessel)

        const haloGeometry = new THREE.RingGeometry(0.03, 0.04, 40)
        const haloMaterial = new THREE.MeshBasicMaterial({ color: 0x8bb9ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
        const halo = new THREE.Mesh(haloGeometry, haloMaterial)
        globe.add(halo)

        // Pointer: a gentle, eased tilt towards the cursor (fine pointers only).
        const fine = window.matchMedia('(pointer: fine)').matches
        const target = { x: 0, y: 0 }
        const current = { x: 0, y: 0 }
        const onPointerMove = (event) => {
          const rect = host.getBoundingClientRect()
          target.x = ((event.clientX - rect.left) / rect.width - 0.5) * 0.35
          target.y = ((event.clientY - rect.top) / rect.height - 0.5) * 0.22
        }
        const onPointerLeave = () => {
          target.x = 0
          target.y = 0
        }
        if (fine) {
          host.addEventListener('pointermove', onPointerMove)
          host.addEventListener('pointerleave', onPointerLeave)
          window.addEventListener('blur', onPointerLeave)
        }

        const resize = () => {
          const { clientWidth, clientHeight } = host
          if (!clientWidth || !clientHeight) return
          renderer.setSize(clientWidth, clientHeight, false)
          camera.aspect = clientWidth / clientHeight
          // Keep the whole globe in frame on narrow panels.
          const aspect = clientWidth / clientHeight
          camera.position.z = aspect < 1 ? 5.2 / Math.max(aspect, 0.5) : 5.2
          camera.updateProjectionMatrix()
        }
        const resizeObserver = new ResizeObserver(resize)
        resizeObserver.observe(host)
        resize()

        // Reused per frame.
        const tilt = new THREE.Quaternion()
        const euler = new THREE.Euler()
        const projected = new THREE.Vector3()
        const world = new THREE.Vector3()
        const normal = new THREE.Vector3()
        const toCamera = new THREE.Vector3()
        const total = routePoints.length - 1

        let frame = 0
        let visible = true
        let started = performance.now()

        const render = (now) => {
          frame = 0
          const elapsed = (now - started) / 1000

          current.x += (target.x - current.x) * 0.05
          current.y += (target.y - current.y) * 0.05
          euler.set(current.y + Math.sin(elapsed * 0.18) * 0.03, current.x + Math.sin(elapsed * 0.11) * 0.12, 0)
          tilt.setFromEuler(euler)
          globe.quaternion.copy(tilt).multiply(baseQuaternion)

          const value = Math.min(Math.max(progress.value, 0), 1)
          const head = Math.max(1, Math.round(value * total))
          route.geometry.setDrawRange(0, head + 1)
          vessel.position.copy(routePoints[head])
          halo.position.copy(routePoints[head])
          halo.lookAt(0, 0, 0)
          const pulse = 1 + ((elapsed * 0.9) % 1) * 1.6
          halo.scale.setScalar(pulse)
          haloMaterial.opacity = 0.6 * (1 - ((elapsed * 0.9) % 1))

          renderer.render(scene, camera)

          // Port labels follow their dots; hidden when the port turns away.
          const rect = host.getBoundingClientRect()
          portVectors.forEach((vector, index) => {
            const label = labelRefs.current[index]
            if (!label) return
            world.copy(vector).applyQuaternion(globe.quaternion)
            normal.copy(world).normalize()
            toCamera.copy(camera.position).sub(world).normalize()
            const facing = normal.dot(toCamera) > 0.15
            projected.copy(world).project(camera)
            const x = (projected.x * 0.5 + 0.5) * rect.width
            const y = (-projected.y * 0.5 + 0.5) * rect.height
            label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
            label.style.opacity = facing ? '1' : '0'
          })

          if (visible && !document.hidden) frame = requestAnimationFrame(render)
        }

        const play = () => {
          if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render)
        }
        const pause = () => {
          if (frame) cancelAnimationFrame(frame)
          frame = 0
        }

        const intersection = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting
          if (visible) play()
          else pause()
        })
        intersection.observe(host)
        const onVisibility = () => (document.hidden ? pause() : play())
        document.addEventListener('visibilitychange', onVisibility)

        const onContextLost = (event) => {
          event.preventDefault()
          pause()
          setMode('fallback')
        }
        renderer.domElement.addEventListener('webglcontextlost', onContextLost)

        setMode('live')
        started = performance.now()
        play()

        cleanup = () => {
          pause()
          intersection.disconnect()
          resizeObserver.disconnect()
          document.removeEventListener('visibilitychange', onVisibility)
          renderer.domElement.removeEventListener('webglcontextlost', onContextLost)
          host.removeEventListener('pointermove', onPointerMove)
          host.removeEventListener('pointerleave', onPointerLeave)
          window.removeEventListener('blur', onPointerLeave)
          ;[bodyGeometry, dotGeometry, routeGeometry, ghostGeometry, portGeometry, vesselGeometry, haloGeometry].forEach((geometry) => geometry.dispose())
          ;[bodyMaterial, dotMaterial, routeMaterial, ghostMaterial, portMaterial, vesselMaterial, haloMaterial].forEach((material) => material.dispose())
          renderer.dispose()
          renderer.domElement.remove()
        }
      })
      .catch(() => {
        if (!disposed) setMode('fallback')
      })

    return () => {
      disposed = true
      cleanup()
    }
    // The voyage and its stops are fixed for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={hostRef} className={`voyage-globe ${className}`} data-mode={mode}>
      {mode === 'live'
        ? stops.map((stop, index) => (
            <span
              key={stop.name}
              ref={(node) => {
                labelRefs.current[index] = node
              }}
              className="voyage-globe-label"
              aria-hidden="true"
            >
              {stop.name}
            </span>
          ))
        : null}
      {mode === 'fallback' ? children : null}
    </div>
  )
}

export default VoyageGlobe
