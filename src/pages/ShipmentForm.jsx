import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '../../firebase'
import useAuth from '../hooks/useAuth'
import {
  carriers,
  detectCarrierFromBlNumber,
  getCarrierBadgeClass,
  getCarrierLabel,
} from '../lib/carriers'
import { lookupTracking, supportsLiveTracking } from '../lib/tracking'

const initialValues = {
  invoiceNo: '',
  blNo: '',
  containerNumbers: '',
  eta: '',
  invAmount: '',
  consigneeName: '',
  notes: '',
  carrier: '',
}

function normalizeDate(value) {
  if (!value) {
    return null
  }

  if (typeof value.toDate === 'function') {
    return value.toDate()
  }

  if (value instanceof Date) {
    return value
  }

  const parsedDate = new Date(value)

  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function formatDateInput(value) {
  const date = normalizeDate(value)

  if (!date) {
    return ''
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function createDateFromInput(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function validate(values) {
  const nextErrors = {}

  if (!values.invoiceNo.trim()) {
    nextErrors.invoiceNo = 'Invoice number is required.'
  }

  if (!values.blNo.trim()) {
    nextErrors.blNo = 'B/L number is required.'
  }

  if (!values.eta) {
    nextErrors.eta = 'ETA is required.'
  }

  if (values.invAmount !== '') {
    const amount = Number(values.invAmount)

    if (Number.isNaN(amount)) {
      nextErrors.invAmount = 'Invoice amount must be a valid number.'
    } else if (amount < 0) {
      nextErrors.invAmount = 'Invoice amount cannot be negative.'
    }
  }

  return nextErrors
}

const lookupDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const idleLookup = { status: 'idle', blNo: '', carrier: '', eta: null, latestEvent: null, eventCount: 0, error: '' }

function formatLookupDate(value) {
  const date = normalizeDate(value)
  return date ? lookupDateFormatter.format(date) : '—'
}

function ShipmentForm() {
  const { shipmentId } = useParams()
  const [searchParams] = useSearchParams()
  // Set by the landing page: the B/L the visitor typed before signing in.
  const prefillBl = shipmentId
    ? ''
    : String(searchParams.get('bl') ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)
  const prefillLookupDoneRef = useRef(false)
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [isLoadingShipment, setIsLoadingShipment] = useState(Boolean(shipmentId))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [lookup, setLookup] = useState(idleLookup)
  const etaTouchedRef = useRef(false)
  const lookupRequestRef = useRef(0)
  const isEditing = Boolean(shipmentId)

  useEffect(() => {
    if (!shipmentId) {
      etaTouchedRef.current = false
      setLookup(idleLookup)
      setValues(
        prefillBl
          ? { ...initialValues, blNo: prefillBl, carrier: detectCarrierFromBlNumber(prefillBl) }
          : initialValues,
      )
      setErrors({})
      setFormError('')
      setIsLoadingShipment(false)
      return undefined
    }

    if (!currentUser?.uid) {
      setIsLoadingShipment(false)
      return undefined
    }

    let isMounted = true

    async function loadShipment() {
      setIsLoadingShipment(true)
      setFormError('')

      try {
        const shipmentRef = doc(db, 'shipments', shipmentId)
        const shipmentSnapshot = await getDoc(shipmentRef)

        if (!shipmentSnapshot.exists()) {
          throw new Error('Shipment not found.')
        }

        const shipment = shipmentSnapshot.data()

        if (shipment.uid !== currentUser.uid) {
          navigate('/dashboard', { replace: true })
          return
        }

        if (!isMounted) {
          return
        }

        // Existing shipment: its ETA was already chosen, never auto-replace it.
        etaTouchedRef.current = true
        setLookup({
          status: shipment.latestEvent ? 'done' : 'idle',
          blNo: String(shipment.blNo ?? shipment.blNumber ?? '').trim().toUpperCase(),
          eta: normalizeDate(shipment.currentEta ?? shipment.eta),
          latestEvent: shipment.latestEvent
            ? {
                ...shipment.latestEvent,
                occurredAt: normalizeDate(shipment.latestEvent.occurredAt),
              }
            : null,
          eventCount: shipment.eventCount ?? 0,
          error: '',
        })

        setValues({
          invoiceNo: shipment.invoiceNo ?? shipment.invoiceNumber ?? '',
          blNo: shipment.blNo ?? shipment.blNumber ?? '',
          containerNumbers: Array.isArray(shipment.containerNumbers)
            ? shipment.containerNumbers.join('\n')
            : shipment.containerNumbers ?? '',
          eta: formatDateInput(shipment.eta),
          invAmount:
            shipment.invAmount === undefined ||
            shipment.invAmount === null ||
            shipment.invAmount === ''
              ? ''
              : String(shipment.invAmount),
          consigneeName: shipment.consigneeName ?? '',
          notes: shipment.notes ?? '',
          carrier:
            shipment.carrier ??
            detectCarrierFromBlNumber(shipment.blNo ?? shipment.blNumber ?? ''),
        })
      } catch (loadError) {
        console.error('Failed to load shipment for editing.', loadError)

        if (isMounted) {
          setFormError(
            loadError instanceof Error
              ? loadError.message
              : 'Unable to load this shipment right now.',
          )
        }
      } finally {
        if (isMounted) {
          setIsLoadingShipment(false)
        }
      }
    }

    loadShipment()

    return () => {
      isMounted = false
    }
  }, [currentUser?.uid, navigate, shipmentId, prefillBl])

  // Load live tracking once for a B/L handed over from the landing page.
  useEffect(() => {
    if (!prefillBl || prefillLookupDoneRef.current || values.blNo !== prefillBl) {
      return
    }

    prefillLookupDoneRef.current = true
    runLookup()
    // runLookup reads the current values; it only needs to run once here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillBl, values.blNo])

  const handleChange = (field) => (event) => {
    const nextValue = event.target.value

    if (field === 'eta') {
      etaTouchedRef.current = true
    }

    setValues((currentValues) => ({
      ...currentValues,
      [field]: nextValue,
    }))

    setErrors((currentErrors) => {
      if (!currentErrors[field]) {
        return currentErrors
      }

      const nextErrors = { ...currentErrors }
      delete nextErrors[field]
      return nextErrors
    })
  }

  const runLookup = async ({ force = false, carrier: carrierOverride } = {}) => {
    const blNo = values.blNo.trim().toUpperCase().replace(/\s+/g, '')
    const carrier = detectCarrierFromBlNumber(blNo) || carrierOverride || values.carrier

    if (!blNo) {
      setLookup(idleLookup)
      return
    }

    if (!supportsLiveTracking(carrier)) {
      setLookup({ ...idleLookup, status: 'unsupported', blNo })
      return
    }

    if (
      !force &&
      lookup.blNo === blNo &&
      lookup.carrier === carrier &&
      lookup.status !== 'error'
    ) {
      return
    }

    const requestId = lookupRequestRef.current + 1
    lookupRequestRef.current = requestId
    setLookup({ ...idleLookup, status: 'loading', blNo, carrier })

    try {
      const result = await lookupTracking({ blNo, carrier })

      if (lookupRequestRef.current !== requestId) {
        return
      }

      const carrierEta = normalizeDate(result.eta)

      setLookup({
        status: 'done',
        blNo,
        carrier,
        eta: carrierEta,
        latestEvent: result.latestEvent
          ? { ...result.latestEvent, occurredAt: normalizeDate(result.latestEvent.occurredAt) }
          : null,
        eventCount: result.eventCount ?? 0,
        error: '',
      })

      // Prefill ETA from the carrier unless the user already typed one.
      if (carrierEta && !etaTouchedRef.current) {
        setValues((currentValues) => ({
          ...currentValues,
          eta: formatDateInput(carrierEta),
        }))
        setErrors((currentErrors) => {
          const nextErrors = { ...currentErrors }
          delete nextErrors.eta
          return nextErrors
        })
      }
    } catch (lookupError) {
      if (lookupRequestRef.current !== requestId) {
        return
      }

      console.error('Tracking lookup failed.', lookupError)
      setLookup({
        ...idleLookup,
        status: 'error',
        blNo,
        carrier,
        error: lookupError?.message || 'Tracking lookup failed.',
      })
    }
  }

  const handleBlBlur = () => {
    const detectedCarrier = detectCarrierFromBlNumber(values.blNo)

    // Keep a manually chosen carrier when the B/L has no known prefix
    // (booking refs without a carrier prefix).
    if (detectedCarrier) {
      setValues((currentValues) => ({
        ...currentValues,
        carrier: detectedCarrier,
      }))
    }

    runLookup()
  }

  const handleCarrierSelect = (event) => {
    const carrier = event.target.value

    setValues((currentValues) => ({
      ...currentValues,
      carrier,
    }))

    if (carrier) {
      runLookup({ force: true, carrier })
    }
  }

  const useCarrierEta = () => {
    if (!lookup.eta) {
      return
    }

    setValues((currentValues) => ({
      ...currentValues,
      eta: formatDateInput(lookup.eta),
    }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const nextErrors = validate(values)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      return
    }

    if (!currentUser?.uid) {
      setFormError('You must be signed in to save a shipment.')
      return
    }

    setIsSubmitting(true)
    setFormError('')

    const detectedCarrier = detectCarrierFromBlNumber(values.blNo)
    const containerNumbers = values.containerNumbers
      .split('\n')
      .map((containerNumber) => containerNumber.trim())
      .filter(Boolean)

    const shipmentPayload = {
      uid: currentUser.uid,
      invoiceNo: values.invoiceNo.trim(),
      blNo: values.blNo.trim(),
      carrier: detectedCarrier || values.carrier || 'Unknown',
      containerNumbers,
      eta: createDateFromInput(values.eta),
      // The ETA the user confirmed on the form is the current official ETA.
      currentEta: createDateFromInput(values.eta),
      invAmount: values.invAmount === '' ? null : Number(values.invAmount),
      consigneeName: values.consigneeName.trim(),
      notes: values.notes.trim(),
      updatedAt: serverTimestamp(),
    }

    try {
      let savedShipmentId = shipmentId

      if (isEditing) {
        await updateDoc(doc(db, 'shipments', shipmentId), shipmentPayload)
      } else {
        const createdRef = await addDoc(collection(db, 'shipments'), {
          ...shipmentPayload,
          createdAt: serverTimestamp(),
        })
        savedShipmentId = createdRef.id
      }

      // Events are server-owned: ask the backend to store them on the shipment.
      // Runs in the background; the dashboard updates live when it finishes.
      if (supportsLiveTracking(shipmentPayload.carrier)) {
        lookupTracking({
          blNo: shipmentPayload.blNo,
          carrier: shipmentPayload.carrier,
          shipmentId: savedShipmentId,
        }).catch((syncError) => {
          console.error('Background tracking sync failed.', syncError)
        })
      }

      navigate('/dashboard')
    } catch (submitError) {
      console.error('Failed to save shipment.', submitError)
      setFormError('Shipment could not be saved. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const pageTitle = isEditing ? 'Edit shipment' : 'Add shipment'
  const pageCopy = isEditing
    ? 'Update the shipment details and keep your ETA list accurate.'
    : 'Capture a new shipment, detect the carrier from the B/L number, and prepare ETA email alerts.'

  return (
    <main className="app-shell mx-auto min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div className="app-motion-card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.24em] text-sky-600 uppercase dark:text-sky-200">
              ShipTrack
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {pageTitle}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              {pageCopy}
            </p>
          </div>

          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
          >
            Back to dashboard
          </Link>
        </div>

        <section className="app-motion-card rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20 sm:p-8">
          {isLoadingShipment ? (
            <div className="flex min-h-80 items-center justify-center text-sm text-slate-500 dark:text-slate-300">
              Loading shipment details...
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleSubmit} noValidate>
              {formError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                  {formError}
                </div>
              ) : null}

              <div className="grid gap-6 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Invoice No
                  <input
                    type="text"
                    value={values.invoiceNo}
                    onChange={handleChange('invoiceNo')}
                    className={`rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition dark:bg-slate-900 dark:text-white ${
                      errors.invoiceNo
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:focus:ring-sky-500/20'
                    }`}
                    placeholder="INV-2026-001"
                    required
                  />
                  {errors.invoiceNo ? (
                    <span className="text-xs text-rose-600 dark:text-rose-200">
                      {errors.invoiceNo}
                    </span>
                  ) : null}
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  B/L Number
                  <input
                    type="text"
                    value={values.blNo}
                    onChange={handleChange('blNo')}
                    onBlur={handleBlBlur}
                    className={`rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition dark:bg-slate-900 dark:text-white ${
                      errors.blNo
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:focus:ring-sky-500/20'
                    }`}
                    placeholder="MEDU1234567"
                    required
                  />
                  <div className="flex min-h-6 items-center gap-2">
                    {detectCarrierFromBlNumber(values.blNo) ? (
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getCarrierBadgeClass(values.carrier)}`}
                      >
                        {getCarrierLabel(values.carrier)}
                      </span>
                    ) : values.blNo.trim() ? (
                      <select
                        aria-label="Carrier"
                        value={values.carrier}
                        onChange={handleCarrierSelect}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-normal text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white"
                      >
                        <option value="">Select carrier…</option>
                        {carriers.map((carrier) => (
                          <option key={carrier.code} value={carrier.code}>
                            {carrier.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Carrier auto-detect runs when you leave this field.
                      </span>
                    )}
                  </div>
                  {errors.blNo ? (
                    <span className="text-xs text-rose-600 dark:text-rose-200">
                      {errors.blNo}
                    </span>
                  ) : null}
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  ETA
                  <input
                    type="date"
                    value={values.eta}
                    onChange={handleChange('eta')}
                    className={`rounded-2xl border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition dark:bg-slate-900 dark:text-white ${
                      errors.eta
                        ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:focus:ring-sky-500/20'
                    }`}
                    required
                  />
                  {errors.eta ? (
                    <span className="text-xs text-rose-600 dark:text-rose-200">
                      {errors.eta}
                    </span>
                  ) : null}
                  {lookup.status === 'done' && lookup.eta ? (
                    <span className="flex flex-wrap items-center gap-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                      Carrier ETA: {formatLookupDate(lookup.eta)}
                      {values.eta !== formatDateInput(lookup.eta) ? (
                        <button
                          type="button"
                          onClick={useCarrierEta}
                          className="font-medium text-sky-600 underline-offset-2 hover:underline dark:text-sky-300"
                        >
                          Use carrier ETA
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </label>


                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  INV Amount
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400">
                      $
                    </span>
                    <input
                      type="number"
                      value={values.invAmount}
                      onChange={handleChange('invAmount')}
                      min="0"
                      step="0.01"
                      className={`w-full rounded-2xl border bg-white py-3 pr-4 pl-8 text-sm text-slate-950 outline-none transition dark:bg-slate-900 dark:text-white ${
                        errors.invAmount
                          ? 'border-rose-300 focus:border-rose-400 focus:ring-2 focus:ring-rose-100 dark:border-rose-500/40 dark:focus:ring-rose-500/20'
                          : 'border-slate-200 focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:focus:ring-sky-500/20'
                      }`}
                      placeholder="12500.00"
                    />
                  </div>
                  {errors.invAmount ? (
                    <span className="text-xs text-rose-600 dark:text-rose-200">
                      {errors.invAmount}
                    </span>
                  ) : null}
                </label>
              </div>

              <section
                aria-live="polite"
                className="rounded-3xl border border-slate-200/70 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Live tracking
                  </p>
                  {lookup.status === 'done' || lookup.status === 'error' ? (
                    <button
                      type="button"
                      onClick={() => runLookup({ force: true })}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-white dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
                    >
                      Refresh
                    </button>
                  ) : null}
                </div>

                {lookup.status === 'idle' ? (
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Enter a B/L number to load the current event and ETA from the carrier.
                  </p>
                ) : null}
                {lookup.status === 'unsupported' ? (
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Live tracking is not available for this carrier. Enter the ETA manually.
                  </p>
                ) : null}
                {lookup.status === 'loading' ? (
                  <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    Checking {lookup.blNo} with the carrier…
                  </p>
                ) : null}
                {lookup.status === 'error' ? (
                  <p className="mt-2 text-xs leading-5 text-rose-600 dark:text-rose-200">
                    {lookup.error} You can still enter the ETA manually.
                  </p>
                ) : null}
                {lookup.status === 'done' ? (
                  <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200/70 bg-white p-3 dark:border-white/10 dark:bg-slate-950/70">
                      <dt className="text-xs tracking-[0.18em] text-slate-500 uppercase dark:text-slate-400">
                        Current event · set by carrier
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                        {lookup.latestEvent?.title ?? 'No events reported yet'}
                      </dd>
                      {lookup.latestEvent ? (
                        <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {[
                            lookup.latestEvent.location,
                            formatLookupDate(lookup.latestEvent.occurredAt),
                            lookup.eventCount > 1 ? `${lookup.eventCount} events` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </dd>
                      ) : null}
                    </div>
                    <div className="rounded-2xl border border-slate-200/70 bg-white p-3 dark:border-white/10 dark:bg-slate-950/70">
                      <dt className="text-xs tracking-[0.18em] text-slate-500 uppercase dark:text-slate-400">
                        Carrier ETA
                      </dt>
                      <dd className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                        {lookup.eta ? formatLookupDate(lookup.eta) : 'Not provided'}
                      </dd>
                      <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                        You can change the ETA field above.
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </section>

              <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                Container numbers
                <textarea
                  value={values.containerNumbers}
                  onChange={handleChange('containerNumbers')}
                  rows={5}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:ring-sky-500/20"
                  placeholder={'MSCU1234567\nMSDU2345678'}
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Add one container number per line. They will be saved as a list.
                </span>
              </label>

              <div className="grid gap-6 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  Consignee name
                  <input
                    type="text"
                    value={values.consigneeName}
                    onChange={handleChange('consigneeName')}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:ring-sky-500/20"
                    placeholder="Acme Distribution Ltd."
                  />
                </label>

                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/5">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    Carrier prefixes
                  </p>
                  <p className="mt-2 text-xs leading-6 text-slate-600 dark:text-slate-300">
                    {carriers.map((carrier) => (
                      <span key={carrier.code} className="block">
                        {carrier.label}: {carrier.prefixes.join(', ')}
                      </span>
                    ))}
                  </p>
                </div>
              </div>

              <label className="flex flex-col gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                Notes
                <textarea
                  value={values.notes}
                  onChange={handleChange('notes')}
                  rows={5}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-white/10 dark:bg-slate-900 dark:text-white dark:focus:ring-sky-500/20"
                  placeholder="Optional handling notes, milestones, or follow-up details."
                />
              </label>

              <div className="flex flex-col gap-3 border-t border-slate-200 pt-6 dark:border-white/10 sm:flex-row sm:items-center sm:justify-end">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-white/5 dark:text-slate-100 dark:hover:bg-white/10"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-cyan-300 dark:text-slate-950 dark:shadow-cyan-400/10 dark:hover:bg-cyan-200"
                >
                  {isSubmitting
                    ? isEditing
                      ? 'Updating shipment...'
                      : 'Saving shipment...'
                    : isEditing
                      ? 'Update shipment'
                      : 'Save shipment'}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}

export default ShipmentForm
