import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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

const carrierBadgeStyles = {
  MSC: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
  ONE: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200',
  EVERGREEN:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200',
  PIL: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-200',
}

const blCarrierMap = [
  { prefixes: ['MEDU', 'MSDU', 'MSNU', 'MSMU', 'MSCU'], carrier: 'MSC' },
  { prefixes: ['ONEY', 'BRDG'], carrier: 'ONE' },
  { prefixes: ['EGLV', 'EGSU', 'EGHU'], carrier: 'EVERGREEN' },
  { prefixes: ['SUB', 'PIL'], carrier: 'PIL' },
]

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

function detectCarrierFromBlNumber(value) {
  const sanitizedValue = String(value).toUpperCase().replace(/[^A-Z0-9]/g, '')

  for (const entry of blCarrierMap) {
    const matchingPrefix = entry.prefixes.find((prefix) =>
      sanitizedValue.startsWith(prefix),
    )

    if (matchingPrefix) {
      return entry.carrier
    }
  }

  return ''
}

function getCarrierBadgeClass(carrier) {
  return (
    carrierBadgeStyles[carrier] ??
    'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200'
  )
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

function ShipmentForm() {
  const { shipmentId } = useParams()
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [values, setValues] = useState(initialValues)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [isLoadingShipment, setIsLoadingShipment] = useState(Boolean(shipmentId))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isEditing = Boolean(shipmentId)

  useEffect(() => {
    if (!shipmentId) {
      setValues(initialValues)
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
  }, [currentUser?.uid, navigate, shipmentId])

  const handleChange = (field) => (event) => {
    const nextValue = event.target.value

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

  const handleBlBlur = () => {
    const detectedCarrier = detectCarrierFromBlNumber(values.blNo)

    setValues((currentValues) => ({
      ...currentValues,
      carrier: detectedCarrier,
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
      invAmount: values.invAmount === '' ? null : Number(values.invAmount),
      consigneeName: values.consigneeName.trim(),
      notes: values.notes.trim(),
      updatedAt: serverTimestamp(),
    }

    try {
      if (isEditing) {
        await updateDoc(doc(db, 'shipments', shipmentId), shipmentPayload)
      } else {
        await addDoc(collection(db, 'shipments'), {
          ...shipmentPayload,
          createdAt: serverTimestamp(),
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
    ? 'Update the shipment details and keep your ETA timeline accurate.'
    : 'Capture a new shipment, detect the carrier from the B/L number, and start tracking alerts.'

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

        <section className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-white/10 dark:bg-slate-950/70 dark:shadow-black/20 sm:p-8">
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
                    {values.carrier ? (
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getCarrierBadgeClass(values.carrier)}`}
                      >
                        {values.carrier}
                      </span>
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
                    MSC: MEDU, MSDU, MSNU, MSMU, MSCU
                    <br />
                    ONE: ONEY, BRDG
                    <br />
                    EVERGREEN: EGLV, EGSU, EGHU
                    <br />
                    PIL: SUB, PIL
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
                  className="inline-flex items-center justify-center rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100"
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
