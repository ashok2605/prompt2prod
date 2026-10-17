// Live backend: Firebase anonymous auth + Firestore realtime listeners for
// reads, REST API (with the Firebase ID token) for writes.
// Loaded lazily so the offline demo never downloads the Firebase SDK.
import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { collection, doc, getFirestore, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { createRestClient } from './api.js'

/** Deep-convert Firestore Timestamps to epoch millis so the UI sees one shape. */
function normalize(value) {
  if (value == null || typeof value !== 'object') return value
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (Array.isArray(value)) return value.map(normalize)
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = normalize(v)
  return out
}

const docData = (snap) => ({ id: snap.id, ...normalize(snap.data()) })

export async function createLiveBackend(config) {
  const app = getApps().length ? getApp() : initializeApp(config.firebase)
  const auth = getAuth(app)
  const db = getFirestore(app)

  await auth.authStateReady()
  if (!auth.currentUser) await signInAnonymously(auth)
  const authListeners = new Set()
  onAuthStateChanged(auth, (user) => authListeners.forEach((cb) => cb(user)))

  const rest = createRestClient(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null))

  const connectionListeners = new Set()
  let connection = 'connecting'
  const setConnection = (state) => {
    if (state === connection) return
    connection = state
    connectionListeners.forEach((cb) => cb(state))
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', () => setConnection('offline'))
    window.addEventListener('online', () => setConnection('connecting'))
  }

  return {
    mode: 'live',
    config,
    get user() {
      return auth.currentUser
    },
    onAuthChange(cb) {
      authListeners.add(cb)
      return () => authListeners.delete(cb)
    },
    get connection() {
      return connection
    },
    onConnectionChange(cb) {
      connectionListeners.add(cb)
      return () => connectionListeners.delete(cb)
    },

    subscribeProjects(cb, onError) {
      return onSnapshot(
        collection(db, 'projects'),
        (snap) => cb(snap.docs.map(docData)),
        (err) => onError?.(err),
      )
    },

    subscribeTasks(cb, onError) {
      const q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'), limit(40))
      return onSnapshot(
        q,
        { includeMetadataChanges: true },
        (snap) => {
          setConnection(snap.metadata.fromCache ? (navigator.onLine === false ? 'offline' : 'connecting') : 'live')
          cb(snap.docs.map(docData))
        },
        (err) => {
          setConnection('error')
          onError?.(err)
        },
      )
    },

    subscribeTask(id, cb, onError) {
      return onSnapshot(
        doc(db, 'tasks', id),
        (snap) => cb(snap.exists() ? docData(snap) : null),
        (err) => onError?.(err),
      )
    },

    subscribeEvents(id, cb, onError) {
      const q = query(collection(db, 'tasks', id, 'events'), orderBy('seq'))
      return onSnapshot(
        q,
        (snap) => cb(snap.docs.map(docData)),
        (err) => onError?.(err),
      )
    },

    createTask: rest.createTask,
    approve: rest.approve,
    reject: rest.reject,
    rollback: rest.rollback,
    retry: rest.retry,
    cancel: rest.cancel,
    resetProject: rest.resetProject,

    // Live mode opens the real URLs.
    openUrl(url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    previewDoc: null,
  }
}
