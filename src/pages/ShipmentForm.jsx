import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { AnimatePresence, motion as Motion, useReducedMotion } from 'motion/react'
import { Icon } from '@iconify/react'
import { db } from '../../firebase'
import useAuth from '../hooks/useAuth'
import { carriers, detectCarrierFromBlNumber, getCarrierBrand } from '../lib/carriers'
import { standardSpring } from '../lib/motion'
import { normalizeDefaultCarrier } from '../lib/profileSettings'
import { toTrackingDate } from '../lib/shipmentDetail'
import { isTrackingNumber, normalizeTrackingNumber, resolveFormCarrier, validateShipmentForm } from '../lib/shipmentForm'
import { lookupTracking, supportsLiveTracking } from '../lib/tracking'
import { readUserSettings } from '../lib/users'
import './ShipmentForm.css'

const initialValues = {
  blNo: '', invoiceNo: '', eta: '', invAmount: '', consigneeName: '', containerNumbers: '', notes: '',
}
const idleLookup = { status: 'idle', eta: null, latestEvent: null, eventCount: 0, error: '' }
const lookupDateFormatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' })

function formatDateInput(date) {
  if (!date) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function createDateFromInput(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function FloatingField({
  name, label, value, error, hint, suffix, accent, type = 'text', rows, required, ...props
}) {
  const id = name === 'blNo' ? 'shipment-bl-number' : `shipment-${name}`
  const Control = rows ? 'textarea' : 'input'
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined
  return (
    <div className="sf-field">
      <div className="sf-control" data-field={name} data-filled={Boolean(value)} data-date={type === 'date'}
        data-suffix={Boolean(accent)} style={accent ? { '--sf-carrier': accent } : undefined}>
        <Control id={id} name={name} value={value} required={required} rows={rows}
          type={rows ? undefined : type} className="st-field"
          aria-invalid={Boolean(error)} aria-describedby={describedBy} {...props} />
        <label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>
        {suffix}
      </div>
      {error && <p className="sf-field-error" id={`${id}-error`}>{error}</p>}
      {hint && <div className="sf-hint" id={`${id}-hint`}>{hint}</div>}
    </div>
  )
}

function CarrierBadge({ code, reducedMotion }) {
  const brand = code ? getCarrierBrand(code) : null
  return (
    <AnimatePresence initial={false}>
      {brand && (
        <Motion.span key={code} className="sf-inline-carrier" aria-hidden="true" data-carrier={code}
          style={{ '--sf-carrier': brand.accent }}
          initial={reducedMotion ? false : { opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, transition: { duration: 0.09 } }}
          transition={reducedMotion ? { duration: 0 } : standardSpring}>
          <i />{brand.label}
        </Motion.span>
      )}
    </AnimatePresence>
  )
}

function CarrierPicker({ selected, detected, onChange, onClear }) {
  return (
    <fieldset className="sf-carriers" aria-describedby="sf-carrier-hint">
      <legend>Carrier</legend>
      <div className="sf-carriers__grid">
        {carriers.map(({ code, label }) => {
          const brand = getCarrierBrand(code)
          return (
            <label className="sf-carrier-option" key={code} style={{ '--sf-carrier': brand.accent }}>
              <input className="sr-only" type="radio" name="carrier" value={code}
                data-skip-bl-lookup
                checked={selected === code} disabled={Boolean(detected)} onChange={() => onChange(code)} />
              <span className="sf-carrier-card">
                {brand.logo ? <img src={brand.logo} alt="" width="38" height="24" /> : <i aria-hidden="true" />}
                <span>{label}</span>
                <span className="sf-carrier-check" aria-hidden="true">
                  <Icon icon="solar:check-circle-bold" width="16" height="16" />
                </span>
              </span>
            </label>
          )
        })}
      </div>
      <p className="sf-hint" id="sf-carrier-hint" aria-live="polite">
        {detected ? `${getCarrierBrand(detected).label} matched from the B/L prefix.`
          : 'Select a carrier if the prefix is not recognized.'}
      </p>
      {!detected && selected && <button type="button" className="sf-text-button" onClick={onClear}>Clear selection</button>}
    </fieldset>
  )
}

function LookupPanel({ lookup, canLookup, hasNumber, onCheck, onUseEta, currentEta }) {
  const busy = lookup.status === 'loading'
  const eventDate = toTrackingDate(lookup.latestEvent?.occurredAt)
  return (
    <div className="sf-lookup">
      <div className="sf-lookup__head">
        <h3>Carrier lookup</h3>
        {canLookup && (
          <button className="sf-text-button" type="button" data-skip-bl-lookup disabled={busy} onClick={onCheck}>
            {lookup.status === 'done' ? 'Refresh' : lookup.status === 'error' ? 'Retry' : 'Check carrier'}
          </button>
        )}
      </div>
      <div className="sf-lookup__result" aria-live="polite">
        {lookup.status === 'done' ? (
          <dl>
            <div>
              <dt>Latest event</dt>
              <dd>{lookup.latestEvent?.title || 'No event reported'}</dd>
              {lookup.latestEvent && (
                <dd className="sf-hint">
                  {[
                    lookup.latestEvent.location,
                    eventDate ? lookupDateFormatter.format(eventDate) : '',
                    lookup.eventCount > 1 ? `${lookup.eventCount} events` : '',
                  ].filter(Boolean).join(' · ')}
                </dd>
              )}
            </div>
            <div>
              <dt>Carrier ETA</dt>
              <dd>{lookup.eta ? lookupDateFormatter.format(lookup.eta) : 'Not available'}</dd>
              {lookup.eta && formatDateInput(lookup.eta) !== currentEta && (
                <dd><button className="sf-text-button" type="button" onClick={onUseEta}>Use carrier ETA</button></dd>
              )}
            </div>
          </dl>
        ) : busy ? <p className="sf-hint">Checking with the carrier…</p>
          : lookup.status === 'error' ? <p className="sf-field-error">{lookup.error} You can enter the ETA manually.</p>
            : <p className="sf-hint">{canLookup ? 'Check for the latest event and arrival estimate.'
              : hasNumber ? 'Enter a complete B/L and select a carrier to check, or set the ETA manually.'
                : 'A carrier check can fill in the estimated arrival date.'}</p>}
      </div>
    </div>
  )
}

function SaveButton({ state, isEditing, reducedMotion, disabled }) {
  const label = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved!' : isEditing ? 'Save changes' : 'Save shipment'
  return (
    <button className="st-primary sf-save" type="submit" disabled={disabled || state !== 'idle'}
      aria-label={label} data-save-state={state}>
      <AnimatePresence initial={false} mode="wait">
        <Motion.span key={state} className="sf-save__content" aria-hidden="true"
          initial={reducedMotion ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? undefined : { opacity: 0, y: -3 }}
          transition={{ duration: reducedMotion ? 0 : 0.12 }}>
          {state === 'saving' && <span className="sf-spinner" />}
          {state === 'saved' && <Icon icon="solar:check-circle-bold" width="19" height="19" />}
          {label}
        </Motion.span>
      </AnimatePresence>
    </button>
  )
}

function ShipmentFormView({ shipmentId, uid, prefillBl }) {
  const navigate = useNavigate()
  const reducedMotion = useReducedMotion()
  const isEditing = Boolean(shipmentId)
  const [incomingBl] = useState(prefillBl)
  const [values, setValues] = useState(() => ({ ...initialValues, blNo: incomingBl }))
  const [manualCarrier, setManualCarrier] = useState(null)
  const [defaultCarrier, setDefaultCarrier] = useState('')
  const [errors, setErrors] = useState({})
  const [invalidFields, setInvalidFields] = useState([])
  const [formError, setFormError] = useState('')
  const [loading, setLoading] = useState(isEditing)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [lookup, setLookup] = useState(idleLookup)
  const formRef = useRef(null)
  const etaOrigin = useRef('')
  const lookupRequest = useRef({ id: 0, key: '' })
  const saveLocked = useRef(false)
  const mounted = useRef(false)
  const redirectTimer = useRef(null)
  const detected = detectCarrierFromBlNumber(values.blNo)
  const selectedCarrier = resolveFormCarrier(values.blNo, manualCarrier ?? defaultCarrier)
  const prefillCarrier = resolveFormCarrier(incomingBl, defaultCarrier)
  const canLookup = isTrackingNumber(values.blNo) && supportsLiveTracking(selectedCarrier)
  const hasBadge = Boolean(normalizeTrackingNumber(values.blNo) && selectedCarrier)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      lookupRequest.current = { id: lookupRequest.current.id + 1, key: '' }
      window.clearTimeout(redirectTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!uid || shipmentId) return
    let ignore = false
    readUserSettings(uid).then((settings) => {
      if (!ignore) setDefaultCarrier(normalizeDefaultCarrier(settings.defaultCarrier))
    }).catch((error) => {
      if (!ignore) console.warn('Could not load default carrier.', error)
    })
    return () => { ignore = true }
  }, [uid, shipmentId])

  useEffect(() => {
    if (!shipmentId || !uid) return
    let ignore = false
    getDoc(doc(db, 'shipments', shipmentId)).then((snapshot) => {
      if (ignore) return
      if (!snapshot.exists()) throw new Error('Shipment not found.')
      const shipment = snapshot.data()
      if (shipment.uid !== uid) {
        navigate('/dashboard', { replace: true })
        return
      }
      const blNo = String(shipment.blNo ?? shipment.blNumber ?? '')
      const eta = toTrackingDate(shipment.currentEta ?? shipment.eta)
      const carrier = resolveFormCarrier(blNo, shipment.carrier)
      etaOrigin.current = 'saved'
      setValues({
        blNo,
        invoiceNo: String(shipment.invoiceNo ?? shipment.invoiceNumber ?? ''),
        eta: formatDateInput(eta),
        invAmount: String(shipment.invAmount ?? ''),
        consigneeName: shipment.consigneeName ?? '',
        containerNumbers: Array.isArray(shipment.containerNumbers) ? shipment.containerNumbers.join('\n') : shipment.containerNumbers ?? '',
        notes: shipment.notes ?? '',
      })
      setManualCarrier(detectCarrierFromBlNumber(blNo) ? '' : carrier)
      if (shipment.latestEvent) {
        lookupRequest.current.key = `${normalizeTrackingNumber(blNo)}:${carrier}`
        setLookup({ ...idleLookup, status: 'done', latestEvent: shipment.latestEvent, eventCount: shipment.eventCount ?? 0 })
      }
      setLoading(false)
    }).catch((loadError) => {
      if (ignore) return
      console.error('Failed to load shipment for editing.', loadError)
      setFormError('This shipment could not be loaded for editing.')
      setLoadFailed(true)
      setLoading(false)
    })
    return () => { ignore = true }
  }, [navigate, shipmentId, uid])

  useLayoutEffect(() => {
    if (!invalidFields.length) return
    formRef.current?.elements.namedItem(invalidFields[0])?.focus()
    if (reducedMotion) return
    const animations = invalidFields.map((field) =>
      formRef.current?.querySelector(`[data-field="${field}"]`)?.animate?.(
        [0, -5, 5, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 310, easing: 'ease-out' },
      ),
    )
    return () => animations.forEach((animation) => animation?.cancel())
  }, [invalidFields, reducedMotion])

  function clearError(field) {
    setErrors((previous) => {
      if (!previous[field]) return previous
      const next = { ...previous }
      delete next[field]
      return next
    })
  }

  function invalidateLookup() {
    lookupRequest.current = { id: lookupRequest.current.id + 1, key: '' }
    setLookup(idleLookup)
    if (etaOrigin.current !== 'carrier') return
    etaOrigin.current = ''
    setValues((previous) => ({ ...previous, eta: '' }))
  }

  function changeField(field, value) {
    if (field === 'eta') etaOrigin.current = 'manual'
    if (field === 'blNo' && normalizeTrackingNumber(value) !== normalizeTrackingNumber(values.blNo)) invalidateLookup()
    setValues((previous) => ({ ...previous, [field]: value }))
    clearError(field)
  }

  async function runLookup(rawBlNo, carrier, force = false) {
    if (saveLocked.current || !isTrackingNumber(rawBlNo) || !supportsLiveTracking(carrier)) return
    const blNo = normalizeTrackingNumber(rawBlNo)
    const key = `${blNo}:${carrier}`
    if (!force && lookupRequest.current.key === key) return
    const id = lookupRequest.current.id + 1
    lookupRequest.current = { id, key }
    setLookup({ ...idleLookup, status: 'loading' })
    try {
      const result = await lookupTracking({ blNo, carrier })
      if (lookupRequest.current.id !== id) return
      const eta = toTrackingDate(result.eta)
      setLookup({ ...idleLookup, status: 'done', eta, latestEvent: result.latestEvent, eventCount: result.eventCount ?? 0 })
      if (eta && !saveLocked.current && (!etaOrigin.current || etaOrigin.current === 'carrier')) {
        etaOrigin.current = 'carrier'
        setValues((previous) => ({ ...previous, eta: formatDateInput(eta) }))
        clearError('eta')
      }
    } catch (lookupError) {
      if (lookupRequest.current.id !== id) return
      lookupRequest.current.key = ''
      console.error('Tracking lookup failed.', lookupError)
      setLookup({ ...idleLookup, status: 'error', error: 'The carrier lookup did not complete.' })
    }
  }

  const runPrefill = useEffectEvent((blNo, carrier) => {
    if (manualCarrier === null && normalizeTrackingNumber(values.blNo) === blNo) runLookup(blNo, carrier)
  })
  useEffect(() => {
    if (shipmentId || !incomingBl || !prefillCarrier) return
    const task = window.setTimeout(() => runPrefill(incomingBl, prefillCarrier), 0)
    return () => window.clearTimeout(task)
  }, [incomingBl, prefillCarrier, shipmentId])

  function selectCarrier(code) {
    if (detected) return
    invalidateLookup()
    setManualCarrier(code)
    runLookup(values.blNo, code)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (saveLocked.current || loadFailed) return
    const nextErrors = validateShipmentForm(values)
    setErrors(nextErrors)
    setInvalidFields(Object.keys(nextErrors))
    if (Object.keys(nextErrors).length) return
    if (!uid) {
      setFormError('Sign in to save this shipment.')
      return
    }

    saveLocked.current = true
    setSaveState('saving')
    setFormError('')
    const eta = createDateFromInput(values.eta)
    const payload = {
      uid,
      invoiceNo: values.invoiceNo.trim(),
      blNo: normalizeTrackingNumber(values.blNo),
      carrier: selectedCarrier || 'Unknown',
      containerNumbers: values.containerNumbers.split('\n').map((number) => number.trim()).filter(Boolean),
      eta,
      currentEta: eta,
      invAmount: values.invAmount === '' ? null : Number(values.invAmount),
      consigneeName: values.consigneeName.trim(),
      notes: values.notes.trim(),
      updatedAt: serverTimestamp(),
    }

    try {
      let savedId = shipmentId
      if (isEditing) await updateDoc(doc(db, 'shipments', shipmentId), payload)
      else savedId = (await addDoc(collection(db, 'shipments'), { ...payload, createdAt: serverTimestamp() })).id

      // Carrier events remain server-owned, and syncing them does not block the save.
      if (supportsLiveTracking(payload.carrier)) {
        lookupTracking({ blNo: payload.blNo, carrier: payload.carrier, shipmentId: savedId })
          .catch((error) => console.error('Background tracking sync failed.', error))
      }
      if (!mounted.current) return
      setSaveState('saved')
      redirectTimer.current = window.setTimeout(() => navigate('/dashboard'), 680)
    } catch (submitError) {
      if (!mounted.current) return
      console.error('Failed to save shipment.', submitError)
      saveLocked.current = false
      setSaveState('idle')
      setFormError('Shipment could not be saved. Your entries are still here; try again.')
    }
  }

  function field(name) {
    return { name, value: values[name], error: errors[name], onChange: (event) => changeField(name, event.target.value) }
  }

  return (
    <main className="sf">
      <header className="sf-header">
        <div>
          <h1>{isEditing ? 'Edit shipment' : 'Add shipment'}</h1>
          <p>{isEditing ? 'Update the tracking reference, arrival estimate, and shipment details.'
            : 'Enter a bill of lading and set an estimated arrival.'}</p>
        </div>
        <Link to="/dashboard" className="sf-back">
          <Icon icon="solar:arrow-left-linear" width="17" height="17" aria-hidden="true" />
          Shipments
        </Link>
      </header>

      {loading ? <p className="sf-panel sf-loading" role="status">Loading shipment details…</p> : (
        <form ref={formRef} onSubmit={handleSubmit} noValidate>
          {formError && <p className="sf-alert" role="alert">{formError}</p>}
          <fieldset className="sf-fields" disabled={saveState !== 'idle' || loadFailed}>
            <section className="sf-section" aria-labelledby="sf-tracking-title">
              <div className="sf-section__intro">
                <h2 id="sf-tracking-title">Tracking</h2>
                <p>ShipTrack matches supported carriers from the B/L prefix as you type.</p>
              </div>
              <div className="sf-panel sf-tracking">
                <FloatingField {...field('blNo')} label="B/L number" required autoComplete="off" autoCapitalize="characters" spellCheck={false}
                  placeholder="MEDU1234567" accent={hasBadge ? getCarrierBrand(selectedCarrier).accent : undefined}
                  onBlur={(event) => {
                    if (!event.relatedTarget?.closest?.('[data-skip-bl-lookup]')) runLookup(values.blNo, selectedCarrier)
                  }}
                  suffix={<CarrierBadge code={hasBadge ? selectedCarrier : ''} reducedMotion={reducedMotion} />} />
                <CarrierPicker selected={selectedCarrier} detected={detected} onChange={selectCarrier} onClear={() => {
                  selectCarrier('')
                  formRef.current?.elements.namedItem('blNo')?.focus()
                }} />
                <LookupPanel lookup={lookup} canLookup={canLookup} hasNumber={Boolean(values.blNo.trim())} currentEta={values.eta}
                  onCheck={() => runLookup(values.blNo, selectedCarrier, true)}
                  onUseEta={() => {
                    if (!lookup.eta) return
                    etaOrigin.current = 'carrier'
                    setValues((previous) => ({ ...previous, eta: formatDateInput(lookup.eta) }))
                    clearError('eta')
                  }} />
              </div>
            </section>

            <section className="sf-section" aria-labelledby="sf-details-title">
              <div className="sf-section__intro">
                <h2 id="sf-details-title">Shipment details</h2>
                <p>Confirm the invoice number and ETA. The remaining fields are optional.</p>
              </div>
              <div className="sf-panel sf-details">
                <FloatingField {...field('invoiceNo')} label="Invoice number" required autoComplete="off" />
                <FloatingField {...field('eta')} label="Estimated arrival" type="date" required />
                <FloatingField {...field('consigneeName')} label="Consignee name" />
                <FloatingField {...field('invAmount')} label="Invoice amount (USD)" type="number" min="0" step="0.01" />
                <FloatingField {...field('containerNumbers')} label="Container numbers" rows={2}
                  hint="One container number per line." spellCheck={false} />
                <FloatingField {...field('notes')} label="Notes" rows={2} />
              </div>
            </section>
          </fieldset>
          <div className="sf-actions">
            <Link to="/dashboard" className="st-secondary sf-cancel">Cancel</Link>
            <SaveButton state={saveState} isEditing={isEditing} reducedMotion={reducedMotion} disabled={loadFailed} />
            <span className="sr-only" role="status">{saveState === 'saved' ? 'Shipment saved.' : saveState === 'saving' ? 'Saving shipment.' : ''}</span>
          </div>
        </form>
      )}
    </main>
  )
}

function ShipmentForm() {
  const { shipmentId } = useParams()
  const [searchParams] = useSearchParams()
  const { currentUser } = useAuth()
  const prefillBl = shipmentId ? '' : normalizeTrackingNumber(searchParams.get('bl')).replace(/[^A-Z0-9-]/g, '')
  const uid = currentUser?.uid
  return <ShipmentFormView key={`${uid}:${shipmentId ?? 'new'}`} shipmentId={shipmentId} prefillBl={prefillBl} uid={uid} />
}

export default ShipmentForm
