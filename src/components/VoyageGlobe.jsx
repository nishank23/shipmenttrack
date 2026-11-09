import { useEffect, useMemo, useRef, useState } from 'react'
import { buildLane } from '../lib/tradeLanes'
import './VoyageGlobe.css'

/**
 * A dotted globe that plays a set of trade lanes. Land dots come from a
 * public-domain NASA land mask (public/globe/land-mask.png). Every lane is
 * drawn as a faint guide; the active one (`voyage.lane`) lights up as a trail
 * that grows to the vessel at `voyage.progress` (an arc-length fraction,
 * 0 to 1). Both values are written by the parent's GSAP timeline and read on
 * each frame.
 *
 * Three.js loads on demand. Rendering pauses offscreen and in hidden tabs,
 * the pixel ratio is capped, nothing is allocated per frame, and everything
 * is disposed on unmount. Without WebGL, on context loss, or under reduced
 * motion, the static fallback (children) is shown instead.
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

const TRAIL_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const TRAIL_FRAGMENT = `
  uniform float uProgress;
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uHead;
  varying vec2 vUv;
  void main() {
    float x = vUv.x;
    if (x > uProgress) discard;
    float trail = smoothstep(uProgress - 0.45, uProgress, x);
    float dash = 0.78 + 0.22 * step(0.5, fract((x - uTime * 0.05) * 70.0));
    vec3 color = mix(uColor, uHead, smoothstep(uProgress - 0.035, uProgress, x));
    gl_FragColor = vec4(color, mix(0.4, 1.0, trail) * dash);
  }`

function VoyageGlobe({ lanes, voyage, zoom = 1, className = '', children }) {
  const hostRef = useRef(null)
  const labelRefs = useRef([])
  const [mode, setMode] = useState('loading')

  // Pure geometry, computed once per lane set.
  const built = useMemo(() => lanes.map((lane) => ({ lane, ...buildLane(lane) })), [lanes])
  const labels = useMemo(
    () =>
      built.flatMap((entry, laneIndex) =>
        entry.stops.map((stop, stopIndex) => ({
          key: `${entry.lane.id}-${stopIndex}`,
          laneIndex,
          stopIndex,
          text: stop.label ?? stop.name,
          destination: stopIndex === entry.stops.length - 1,
          lat: stop.lat,
          lon: stop.lon,
        })),
      ),
    [built],
  )

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
        const geometries = []
        const materials = []
        const track = (geometry, material) => {
          if (geometry) geometries.push(geometry)
          if (material) materials.push(material)
        }

        // The view follows the active lane: yaw the focus longitude to the
        // front, then pitch its latitude to the centre, so north stays up.
        const AXIS_X = new THREE.Vector3(1, 0, 0)
        const AXIS_Y = new THREE.Vector3(0, 1, 0)
        const yaw = new THREE.Quaternion()
        const pitch = new THREE.Quaternion()
        const baseQuaternion = new THREE.Quaternion()
        const firstFocus = lanes[0].focus.from
        const view = { lat: firstFocus.lat, lon: firstFocus.lon }
        const setView = (lat, lon) => {
          yaw.setFromAxisAngle(AXIS_Y, -Math.PI / 2 - (lon * Math.PI) / 180)
          pitch.setFromAxisAngle(AXIS_X, (lat * Math.PI) / 180)
          baseQuaternion.copy(pitch).multiply(yaw)
        }
        setView(view.lat, view.lon)
        globe.quaternion.copy(baseQuaternion)

        // A faint rim of light gives the globe its depth.
        const atmosphereGeometry = new THREE.SphereGeometry(RADIUS * 1.055, 64, 64)
        const atmosphereMaterial = new THREE.ShaderMaterial({
          uniforms: { uColor: { value: new THREE.Color(0x5b8fe6) } },
          vertexShader: `
            varying vec3 vNormal;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
          fragmentShader: `
            uniform vec3 uColor;
            varying vec3 vNormal;
            void main() {
              float rim = pow(clamp(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 4.0);
              gl_FragColor = vec4(uColor, rim * 0.35);
            }`,
          side: THREE.BackSide,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        })
        track(atmosphereGeometry, atmosphereMaterial)
        scene.add(new THREE.Mesh(atmosphereGeometry, atmosphereMaterial))

        // Body: a dark sphere so the far side's dots never show through.
        const bodyGeometry = new THREE.SphereGeometry(RADIUS * 0.995, 64, 64)
        const bodyMaterial = new THREE.MeshBasicMaterial({ color: 0x0c1526 })
        track(bodyGeometry, bodyMaterial)
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
          const u = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * mask.width)
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
        track(dotGeometry, dotMaterial)
        globe.add(new THREE.Points(dotGeometry, dotMaterial))

        // Lanes: a faint guide for every lane, and a lit trail for the active one.
        const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x8bb9ff, transparent: true, opacity: 0.12, depthWrite: false })
        const ghostActiveMaterial = new THREE.MeshBasicMaterial({ color: 0x8bb9ff, transparent: true, opacity: 0.26, depthWrite: false })
        track(null, ghostMaterial)
        track(null, ghostActiveMaterial)

        const laneObjects = built.map((entry) => {
          const curve = new THREE.CatmullRomCurve3(entry.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])))
          const segments = Math.min(900, Math.max(160, entry.points.length * 3))
          const trailGeometry = new THREE.TubeGeometry(curve, segments, 0.0058, 8, false)
          const trailMaterial = new THREE.ShaderMaterial({
            uniforms: {
              uProgress: { value: 0 },
              uTime: { value: 0 },
              uColor: { value: new THREE.Color(0x6f9ef0) },
              uHead: { value: new THREE.Color(0xffffff) },
            },
            vertexShader: TRAIL_VERTEX,
            fragmentShader: TRAIL_FRAGMENT,
            transparent: true,
            depthWrite: false,
          })
          const trail = new THREE.Mesh(trailGeometry, trailMaterial)
          trail.visible = false
          const ghostGeometry = new THREE.TubeGeometry(curve, segments, 0.0026, 6, false)
          const ghost = new THREE.Mesh(ghostGeometry, ghostMaterial)
          track(trailGeometry, trailMaterial)
          track(ghostGeometry, null)
          globe.add(ghost)
          globe.add(trail)
          return { curve, trail, trailMaterial, ghost, stopFractions: entry.stopFractions }
        })

        // Ports: one marker per named stop, lit once the active voyage reaches it.
        const portGeometry = new THREE.SphereGeometry(0.013, 16, 16)
        const portMaterial = new THREE.MeshBasicMaterial({ color: 0xeef1f6 })
        const portIdleMaterial = new THREE.MeshBasicMaterial({ color: 0x55688a })
        track(portGeometry, portMaterial)
        track(null, portIdleMaterial)
        const ports = labels.map((label) => {
          const vector = new THREE.Vector3(...latLonToXYZ(label.lat, label.lon, RADIUS + 0.004, point))
          const mesh = new THREE.Mesh(portGeometry, portIdleMaterial)
          mesh.position.copy(vector)
          globe.add(mesh)
          return { vector, mesh, reached: false, shown: false }
        })

        // The active destination keeps a steady pulse: that is where the ETA points.
        const beaconGeometry = new THREE.RingGeometry(0.022, 0.03, 40)
        const beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffc56b, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })
        track(beaconGeometry, beaconMaterial)
        const beacon = new THREE.Mesh(beaconGeometry, beaconMaterial)
        globe.add(beacon)

        const vesselGeometry = new THREE.SphereGeometry(0.024, 20, 20)
        const vesselMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff })
        track(vesselGeometry, vesselMaterial)
        const vessel = new THREE.Mesh(vesselGeometry, vesselMaterial)
        globe.add(vessel)

        const haloGeometry = new THREE.RingGeometry(0.03, 0.04, 40)
        const haloMaterial = new THREE.MeshBasicMaterial({ color: 0x8bb9ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
        track(haloGeometry, haloMaterial)
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
          const aspect = clientWidth / clientHeight
          camera.aspect = aspect
          // Keep the whole globe in frame on narrow panels; `zoom` moves in
          // for a regional voyage, less on small panels so labels keep room.
          const distance = Math.max(5.2 / Math.min(zoom, clientWidth < 600 ? 1.25 : zoom), 2.4)
          camera.position.z = aspect < 1 ? distance / Math.max(aspect, 0.5) : distance
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

        let activeLane = -1
        let frame = 0
        let visible = true
        let started = performance.now()

        const activate = (laneIndex) => {
          activeLane = laneIndex
          laneObjects.forEach((object, index) => {
            object.trail.visible = index === laneIndex
            object.ghost.material = index === laneIndex ? ghostActiveMaterial : ghostMaterial
          })
          let destinationIndex = 0
          labels.forEach((label, index) => {
            if (label.laneIndex === laneIndex && label.destination) destinationIndex = index
            ports[index].reached = false
            ports[index].mesh.material = portIdleMaterial
            const node = labelRefs.current[index]
            if (node) node.dataset.reached = 'false'
          })
          beacon.position.copy(ports[destinationIndex].vector)
          beacon.lookAt(0, 0, 0)
        }

        const render = (now) => {
          frame = 0
          const elapsed = (now - started) / 1000
          const laneIndex = Math.min(Math.max(voyage.lane | 0, 0), laneObjects.length - 1)
          if (laneIndex !== activeLane) activate(laneIndex)
          const lane = lanes[laneIndex]
          const object = laneObjects[laneIndex]
          const fraction = Math.min(Math.max(voyage.progress, 0), 1)

          // Ease the view towards where the vessel is heading.
          const targetLat = lane.focus.from.lat + (lane.focus.to.lat - lane.focus.from.lat) * fraction
          let targetLon = lane.focus.from.lon + (lane.focus.to.lon - lane.focus.from.lon) * fraction
          while (targetLon - view.lon > 180) targetLon -= 360
          while (targetLon - view.lon < -180) targetLon += 360
          view.lat += (targetLat - view.lat) * 0.035
          view.lon += (targetLon - view.lon) * 0.035
          setView(view.lat, view.lon)

          current.x += (target.x - current.x) * 0.05
          current.y += (target.y - current.y) * 0.05
          euler.set(current.y + Math.sin(elapsed * 0.18) * 0.03, current.x + Math.sin(elapsed * 0.11) * 0.08, 0)
          tilt.setFromEuler(euler)
          globe.quaternion.copy(tilt).multiply(baseQuaternion)

          object.trailMaterial.uniforms.uProgress.value = Math.max(fraction, 0.002)
          object.trailMaterial.uniforms.uTime.value = elapsed
          object.curve.getPointAt(fraction, vessel.position)
          halo.position.copy(vessel.position)
          halo.lookAt(0, 0, 0)
          const pulse = (elapsed * 0.9) % 1
          halo.scale.setScalar(1 + pulse * 1.6)
          haloMaterial.opacity = 0.6 * (1 - pulse)
          const beat = (elapsed * 0.6) % 1
          beacon.scale.setScalar(1 + beat * 1.8)
          beaconMaterial.opacity = 0.8 * (1 - beat)

          renderer.render(scene, camera)

          // Labels: only the active lane's ports, following their dots.
          const rect = host.getBoundingClientRect()
          for (let index = 0; index < labels.length; index += 1) {
            const label = labels[index]
            const port = ports[index]
            const node = labelRefs.current[index]
            const inLane = label.laneIndex === laneIndex
            if (inLane) {
              const reached = fraction >= object.stopFractions[label.stopIndex] - 0.001
              if (reached !== port.reached) {
                port.reached = reached
                port.mesh.material = reached ? portMaterial : portIdleMaterial
                if (node) node.dataset.reached = reached ? 'true' : 'false'
              }
            }
            if (!node) continue
            world.copy(port.vector).applyQuaternion(globe.quaternion)
            normal.copy(world).normalize()
            toCamera.copy(camera.position).sub(world).normalize()
            const facing = normal.dot(toCamera) > 0.15
            const shown = inLane && facing
            if (shown) {
              projected.copy(world).project(camera)
              const x = (projected.x * 0.5 + 0.5) * rect.width
              const y = (-projected.y * 0.5 + 0.5) * rect.height
              node.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
              // Near the right edge the label sits on the dot's left instead.
              port.width ??= node.offsetWidth
              const side = x + port.width > rect.width - 8 ? 'left' : 'right'
              if (side !== port.side) {
                port.side = side
                node.dataset.side = side
              }
            }
            if (shown !== port.shown) {
              port.shown = shown
              node.style.opacity = shown ? '1' : '0'
            }
          }

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
          geometries.forEach((geometry) => geometry.dispose())
          materials.forEach((material) => material.dispose())
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
    // Lanes are fixed for the life of the component; `voyage` is a mutable
    // object read every frame, never a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, zoom])

  return (
    <div ref={hostRef} className={`voyage-globe ${className}`} data-mode={mode}>
      {mode === 'live'
        ? labels.map((label, index) => (
            <span
              key={label.key}
              ref={(node) => {
                labelRefs.current[index] = node
              }}
              className="voyage-globe-label"
              data-destination={label.destination || undefined}
              aria-hidden="true"
            >
              {label.text}
            </span>
          ))
        : null}
      {mode === 'fallback' ? children : null}
    </div>
  )
}

export default VoyageGlobe
