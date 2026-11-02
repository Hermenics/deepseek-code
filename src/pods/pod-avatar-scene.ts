import * as THREE from 'three'
import type { PodAppearance } from './types.js'
import { POD_TONE_COLORS } from './types.js'

// One WebGL context for the entire roster. Only visible avatars are animated.
const views = new Map<HTMLElement, { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; appearance: PodAppearance; state: string; yaw: number; pitch: number; visible: boolean; dirty: boolean; editable: boolean }>()
const models = new Map<string, THREE.Group>()
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
let renderer: THREE.WebGLRenderer | undefined
let unavailable = false, frame = 0, lastFrame = 0
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(32, 1, .1, 30)
camera.position.set(0, .05, 5.4)
scene.add(new THREE.HemisphereLight(0xffffff, 0x8291b0, 2.3))
for (const [color, intensity, position] of [[0xfff3de, 3.8, [-3, 4, 5]], [0xc1dcff, 2, [4, 1, 3]], [0xffffff, 2.7, [0, 3, -4]]] as const) {
  const light = new THREE.DirectionalLight(color, intensity)
  light.position.set(position[0], position[1], position[2])
  scene.add(light)
}
const textureData = new Uint8Array(64 * 64 * 4)
let random = 73
for (let i = 0; i < textureData.length; i += 4) {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0
  const value = 110 + random % 145
  textureData.set([value, value, value, 255], i)
}
const felt = new THREE.DataTexture(textureData, 64, 64)
felt.wrapS = felt.wrapT = THREE.RepeatWrapping
felt.repeat.set(10, 10)
felt.needsUpdate = true

export function makePodModel(appearance: PodAppearance): THREE.Group {
  const pod = new THREE.Group()
  pod.name = 'Pod'
  const material = new THREE.MeshStandardMaterial({ color: POD_TONE_COLORS[appearance.tone], roughness: 1, metalness: 0, bumpMap: felt, bumpScale: .018 })
  material.name = 'Felt'
  const bodyGeometry = new THREE.SphereGeometry(.9, 64, 40)
  const positions = bodyGeometry.attributes.position
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), angle = Math.atan2(y, x)
    let radius = 1
    switch (appearance.shape) {
      case 'cloud': radius = 1 + .1 * Math.cos(5 * angle + .3) * Math.max(0, Math.sin(angle)); break
      case 'clover': radius = 1 + .19 * Math.cos(4 * angle); break
      case 'star': radius = 1 + .22 * Math.cos(5 * (angle - Math.PI / 2)); break
      case 'square': radius = Math.pow(Math.pow(Math.cos(angle), 4) + Math.pow(Math.sin(angle), 4), -.25) * .91; break
      case 'diamond': radius = Math.pow(Math.pow(Math.cos(angle + Math.PI / 4), 4) + Math.pow(Math.sin(angle + Math.PI / 4), 4), -.25) * .85; break
      case 'triangle': radius = 1 + .16 * Math.cos(3 * (angle - Math.PI / 2)); break
      case 'flower': radius = 1 + .16 * Math.cos(6 * angle); break
      case 'heart': {
        const distance = Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2))
        radius = 1 - .1 * Math.sin(angle) - .38 * Math.exp(-Math.pow(distance / .35, 2))
        break
      }
    }
    let width = appearance.shape === 'heart' || appearance.shape === 'cloud' ? 1.1 : 1
    let height = appearance.shape === 'cloud' ? .82 : 1
    let shift = 0
    if (appearance.shape === 'capsule') { width = .78; height = 1.18 }
    if (appearance.shape === 'pear') { width = .94 - .25 * y / .9; height = 1.08 }
    if (appearance.shape === 'droplet') { width = .88 - .28 * y / .9; height = 1.15 }
    if (appearance.shape === 'bean') { width = .85; height = 1.08; shift = .15 * Math.cos(y / .9 * Math.PI) }
    positions.setXYZ(i, x * radius * width + shift, y * radius * height, z * .8)
  }
  bodyGeometry.computeVertexNormals()
  bodyGeometry.computeBoundingBox()
  pod.add(namedMesh('Body', bodyGeometry, material))
  // Short geometry fibers make the silhouette soft from every viewing angle.
  const fiberPositions: number[] = []
  const normals = bodyGeometry.attributes.normal
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i)
    fiberPositions.push(x, y, z, x + normals.getX(i) * .014, y + normals.getY(i) * .014, z + normals.getZ(i) * .014)
  }
  const fibers = new THREE.BufferGeometry()
  fibers.setAttribute('position', new THREE.Float32BufferAttribute(fiberPositions, 3))
  const fiberMaterial = new THREE.LineBasicMaterial({ color: POD_TONE_COLORS[appearance.tone], transparent: true, opacity: .48 })
  fiberMaterial.name = 'Fuzz'
  const fuzz = new THREE.LineSegments(fibers, fiberMaterial)
  fuzz.name = 'Fuzz'
  pod.add(fuzz)
  const dark = new THREE.MeshStandardMaterial({ color: 0x222632, roughness: .45 })
  dark.name = 'Charcoal'
  const white = new THREE.MeshStandardMaterial({ color: 0xfffdf4, roughness: .6 })
  white.name = 'Eye white'
  const top = bodyGeometry.boundingBox!.max.y
  const fabric = new THREE.MeshStandardMaterial({ color: 0x354861, roughness: .95, bumpMap: felt, bumpScale: .01 })
  fabric.name = 'Accessory fabric'
  const eyes = new THREE.Group()
  eyes.name = 'Eyes'
  for (const side of [-1, 1]) {
    const eye = namedMesh('Eye', new THREE.SphereGeometry(1, 24, 16), white)
    eye.scale.set(.185, appearance.eyes === 'curious' && side === 1 ? .255 : .215, .095)
    eye.position.set(side * .255, .06, .685)
    const pupil = namedMesh('Pupil', new THREE.SphereGeometry(1, 24, 16), dark)
    pupil.scale.set(.095, appearance.eyes === 'happy' ? .038 : .125, .07)
    pupil.position.set(side * .255, .045, .775)
    const highlight = namedMesh('Eye glint', new THREE.SphereGeometry(.022, 12, 8), white)
    highlight.position.set(side * .255 - .024, .09, .835)
    eyes.add(eye, pupil, highlight)
  }
  pod.add(eyes)
  if (appearance.accessory === 'glasses' || appearance.accessory === 'sunglasses') {
    for (const side of [-1, 1]) {
      const ring = namedMesh('Glasses lens rim', new THREE.TorusGeometry(.225, .025, 12, 40), dark)
      ring.position.set(side * .26, .055, .88)
      pod.add(ring)
      if (appearance.accessory === 'sunglasses') {
        const lens = namedMesh('Sunglass lens', new THREE.SphereGeometry(1, 24, 16), dark)
        lens.scale.set(.215, .215, .028)
        lens.position.copy(ring.position)
        pod.add(lens)
      }
      pod.add(tube('Glasses arm', [[side * .48, .08, .85], [side * .72, .1, .56], [side * .8, .04, .05]], .023, dark))
    }
    pod.add(tube('Glasses bridge', [[-.04, .065, .88], [0, .09, .91], [.04, .065, .88]], .023, dark))
  } else if (appearance.accessory === 'headphones') {
    pod.add(tube('Headband', [[-.9, .05, 0], [-.83, .65, 0], [0, 1.02, 0], [.83, .65, 0], [.9, .05, 0]], .065, dark))
    for (const side of [-1, 1]) {
      const ear = namedMesh('Headphone ear cushion', new THREE.SphereGeometry(1, 24, 16), dark)
      ear.scale.set(.13, .25, .23)
      ear.position.set(side * .9, .05, 0)
      pod.add(ear)
    }
  } else if (appearance.accessory === 'cap') {
    const cap = namedMesh('Beret', new THREE.SphereGeometry(1, 32, 20), dark)
    cap.scale.set(.55, .14, .47)
    cap.position.set(-.12, top - .05, .02)
    cap.rotation.z = -.2
    const stem = namedMesh('Beret stem', new THREE.SphereGeometry(.065, 16, 12), dark)
    stem.position.set(-.16, top + .11, .02)
    pod.add(cap, stem)
  } else if (appearance.accessory === 'bowtie') {
    for (const side of [-1, 1]) {
      const wing = namedMesh('Bow tie wing', new THREE.SphereGeometry(1, 24, 16), fabric)
      wing.scale.set(.18, .12, .07); wing.position.set(side * .16, -.39, .72); wing.rotation.z = side * .25
      pod.add(wing)
    }
    const knot = namedMesh('Bow tie knot', new THREE.SphereGeometry(.08, 16, 12), fabric)
    knot.position.set(0, -.39, .77); pod.add(knot)
  } else if (appearance.accessory === 'scarf') {
    const collar = namedMesh('Scarf collar', new THREE.TorusGeometry(.7, .075, 12, 48), fabric)
    collar.rotation.x = Math.PI / 2; collar.scale.set(1, .87, 1); collar.position.y = -.5
    pod.add(collar, tube('Scarf tail', [[.29, -.5, .63], [.35, -.72, .67], [.28, -.88, .58]], .095, fabric))
  } else if (appearance.accessory === 'bucket-hat') {
    const hat = namedMesh('Bucket hat', new THREE.CylinderGeometry(.35, .47, .28, 32), fabric)
    hat.position.set(0, top + .03, 0)
    const brim = namedMesh('Bucket brim', new THREE.CylinderGeometry(.5, .65, .08, 32), fabric)
    brim.position.set(0, top - .1, 0); pod.add(hat, brim)
  } else if (appearance.accessory === 'antenna') {
    pod.add(tube('Antenna stem', [[0, top - .03, 0], [.06, top + .18, 0], [.12, top + .26, 0]], .023, dark))
    const tip = namedMesh('Antenna tip', new THREE.SphereGeometry(.1, 20, 16), fabric)
    tip.position.set(.12, top + .26, 0); pod.add(tip)
  } else if (appearance.accessory === 'crown') {
    const gold = new THREE.MeshStandardMaterial({ color: 0xe3b665, roughness: .5, metalness: .25 })
    const band = namedMesh('Crown band', new THREE.TorusGeometry(.33, .06, 12, 32), gold)
    band.rotation.x = Math.PI / 2; band.position.y = top; pod.add(band)
    for (let i = 0; i < 5; i++) {
      const peak = namedMesh('Crown point', new THREE.ConeGeometry(.09, .22, 4), gold), angle = i * Math.PI * 2 / 5
      peak.position.set(Math.sin(angle) * .33, top + .1, Math.cos(angle) * .33); pod.add(peak)
    }
  }
  return pod
}
function namedMesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  return mesh
}
function tube(name: string, points: number[][], radius: number, material: THREE.Material) {
  return namedMesh(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p as [number, number, number]))), 32, radius, 8, false), material)
}
function disposeModel(model: THREE.Group) {
  const materials = new Set<THREE.Material>()
  model.traverse(part => {
    if (part instanceof THREE.Mesh || part instanceof THREE.LineSegments) {
      part.geometry.dispose()
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) materials.add(material)
    }
  })
  for (const material of materials) material.dispose()
}
function getModel(appearance: PodAppearance) {
  const key = JSON.stringify(appearance)
  let model = models.get(key)
  if (!model) model = makePodModel(appearance)
  models.delete(key)
  models.set(key, model)
  if (models.size > 24) {
    const oldest = models.keys().next().value!
    disposeModel(models.get(oldest)!)
    models.delete(oldest)
  }
  return model
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const view = views.get(entry.target as HTMLElement)
    if (view) { view.visible = entry.isIntersecting; view.dirty = true }
  }
  schedule()
})
const resizeObserver = new ResizeObserver(entries => {
  for (const entry of entries) { const view = views.get(entry.target as HTMLElement); if (view) view.dirty = true }
  schedule()
})
function schedule() { if (!frame && !document.hidden) frame = requestAnimationFrame(draw) }
function draw(now: number) {
  frame = 0
  if (document.hidden) return
  if (now - lastFrame < 1000 / 24) { schedule(); return }
  lastFrame = now
  let animate = false
  for (const [element, view] of views) {
    if (!element.isConnected) { observer.unobserve(element); resizeObserver.unobserve(element); views.delete(element); continue }
    if (!view.visible || !element.getClientRects().length) continue
    if (!view.dirty && (reducedMotion.matches || view.editable)) continue
    if (!renderer) {
      if (unavailable) { if (element.dataset.renderer !== 'unavailable') { element.dataset.renderer = 'unavailable'; view.canvas.hidden = true; element.title = '3D preview needs WebGL 2. Appearance controls still work.'; element.append(document.createTextNode('◕ ◕')) } continue }
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
        renderer.setSize(256, 256, false)
        renderer.setClearColor(0, 0)
        renderer.outputColorSpace = THREE.SRGBColorSpace
        renderer.toneMapping = THREE.ACESFilmicToneMapping
      } catch {
        unavailable = true
        for (const [host, item] of views) { host.dataset.renderer = 'unavailable'; item.canvas.hidden = true; host.title = '3D preview needs WebGL 2. Appearance controls still work.'; host.append(document.createTextNode('◕ ◕')) }
        break
      }
    }
    animate ||= !reducedMotion.matches && !view.editable
    const model = getModel(view.appearance), seconds = now / 1000
    const movement = reducedMotion.matches || view.editable ? 0 : 1
    const speed = view.state === 'running' ? 3 : view.state === 'queued' ? 2.2 : 1.4
    model.rotation.set(view.pitch, view.yaw + movement * Math.sin(seconds * speed) * .075, movement * Math.sin(seconds * speed) * (['waiting', 'blocked'].includes(view.state) ? .11 : .025))
    model.position.y = movement * Math.sin(seconds * speed) * (view.state === 'running' ? .06 : view.state === 'queued' ? .04 : .018)
    if (view.state === 'completed') model.rotation.z += movement * Math.sin(seconds * 2) * .04
    if (view.state === 'failed') model.rotation.z -= movement * .09
    const breathe = movement * Math.sin(seconds * speed) * .025
    model.scale.set(1 - breathe * .5, 1 + breathe, 1)
    const eyes = model.getObjectByName('Eyes')!
    const blink = movement && (seconds % 5.3 < .15 || view.state === 'paused') ? .15 : 1
    eyes.scale.y = blink
    eyes.position.x = movement * Math.sin(seconds * (view.state === 'running' ? 2 : .6)) * .025
    const size = Math.min(512, Math.max(64, Math.round(element.clientWidth * Math.min(devicePixelRatio || 1, 2))))
    if (renderer.domElement.width !== size) renderer.setSize(size, size, false)
    scene.add(model)
    renderer.render(scene, camera)
    scene.remove(model)
    if (view.canvas.width !== size) view.canvas.width = view.canvas.height = size
    view.context.clearRect(0, 0, size, size)
    view.context.drawImage(renderer.domElement, 0, 0, size, size)
    element.dataset.renderer = 'webgl'
    element.dataset.yaw = view.yaw.toFixed(3)
    element.dataset.pitch = view.pitch.toFixed(3)
    element.dataset.frame = String(Number(element.dataset.frame || 0) + 1)
    view.dirty = false
  }
  if (animate) schedule()
}
function mount(element: HTMLElement, appearance: PodAppearance, state = 'ready', editable = false) {
  let view = views.get(element)
  if (view) {
    if (JSON.stringify(view.appearance) !== JSON.stringify(appearance) || view.state !== state) { view.appearance = appearance; view.state = state; view.dirty = true; schedule() }
    return
  }
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  view = { canvas, context, appearance, state, yaw: .15, pitch: -.07, visible: true, dirty: true, editable }
  views.set(element, view)
  element.replaceChildren(canvas)
  observer.observe(element)
  resizeObserver.observe(element)
  if (editable) {
    element.removeAttribute('aria-hidden')
    canvas.tabIndex = 0
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', '3D Pod. Drag to rotate. Arrow keys rotate; Home resets the view.')
    let pointer: number | null = null, x = 0, y = 0
    canvas.addEventListener('pointerdown', event => {
      if (pointer !== null || event.button !== 0) return
      pointer = event.pointerId; x = event.clientX; y = event.clientY
      canvas.setPointerCapture(pointer); canvas.focus()
    })
    canvas.addEventListener('pointermove', event => {
      if (pointer !== event.pointerId) return
      view!.yaw += (event.clientX - x) * .015
      view!.pitch = THREE.MathUtils.clamp(view!.pitch + (event.clientY - y) * .012, -1.2, 1.2)
      x = event.clientX; y = event.clientY; view!.dirty = true; schedule()
    })
    const release = (event: PointerEvent) => { if (pointer === event.pointerId) pointer = null }
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('lostpointercapture', release)
    canvas.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
      event.preventDefault()
      if (event.key === 'Home') { view!.yaw = .15; view!.pitch = -.07 }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') view!.yaw += event.key === 'ArrowLeft' ? -.2 : .2
      else view!.pitch = THREE.MathUtils.clamp(view!.pitch + (event.key === 'ArrowUp' ? -.15 : .15), -1.2, 1.2)
      view!.dirty = true; schedule()
    })
  }
  schedule()
}
function reset(element: HTMLElement) {
  const view = views.get(element)
  if (view) { view.yaw = .15; view.pitch = -.07; view.dirty = true; schedule() }
}
reducedMotion.addEventListener('change', () => { for (const view of views.values()) view.dirty = true; schedule() })
document.addEventListener('visibilitychange', schedule)
window.addEventListener('pagehide', event => {
  if (event.persisted) return
  cancelAnimationFrame(frame); frame = 0
  observer.disconnect(); resizeObserver.disconnect(); views.clear()
  for (const model of models.values()) disposeModel(model)
  models.clear(); renderer?.dispose(); renderer = undefined; felt.dispose()
})
Object.assign(window, { Pod3D: { mount, reset } })
