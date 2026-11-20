import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth, signInWithPopup, signOut } from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { SiteSettings, YouTubeVideoRecord } from '../types';

const app = initializeApp(firebaseConfig);
const dbId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
export const db =
  dbId && dbId !== '(default)' ? getFirestore(app, dbId) : getFirestore(app);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export async function signInWithGooglePopup(): Promise<{ idToken: string; email: string }> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  const idToken = await cred.user.getIdToken();
  return { idToken, email: cred.user.email || '' };
}

export async function signOutFirebase(): Promise<void> {
  try {
    await signOut(auth);
  } catch {
    // ignore signout error when not signed in via Firebase
  }
}

function normalizeTimestamp(val: unknown): string {
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as Timestamp).toDate === 'function') {
    return (val as Timestamp).toDate().toISOString();
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

export async function fetchSiteSettingsFromFirestore(): Promise<SiteSettings | null> {
  try {
    const snap = await getDocFromServer(doc(db, 'settings', 'site'));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      return {
        websiteName: String(data.websiteName || 'KAKAROT GLORY PRO'),
        websiteLogo: String(data.websiteLogo || ''),
        websiteTitle: String(data.websiteTitle || data.websiteName || 'KAKAROT GLORY PRO'),
        websiteDescription: String(data.websiteDescription || ''),
        websiteAnnouncement: String(data.websiteAnnouncement || ''),
        registrationEnabled: Boolean(data.registrationEnabled ?? true),
        maintenanceMode: Boolean(data.maintenanceMode ?? false),
        websiteNotificationsEnabled: Boolean(data.websiteNotificationsEnabled ?? true),
        updatedAt: normalizeTimestamp(data.updatedAt),
        updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function subscribeToSiteSettings(
  onUpdate: (settings: SiteSettings) => void,
  onError?: (err: unknown) => void
): () => void {
  const path = 'settings/site';
  return onSnapshot(
    doc(db, 'settings', 'site'),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Record<string, unknown>;
      if (!data.websiteName) return;
      onUpdate({
        websiteName: String(data.websiteName),
        websiteLogo: String(data.websiteLogo || ''),
        websiteTitle: String(data.websiteTitle || data.websiteName),
        websiteDescription: String(data.websiteDescription || ''),
        websiteAnnouncement: String(data.websiteAnnouncement || ''),
        registrationEnabled: Boolean(data.registrationEnabled ?? true),
        maintenanceMode: Boolean(data.maintenanceMode ?? false),
        websiteNotificationsEnabled: Boolean(data.websiteNotificationsEnabled ?? true),
        updatedAt: normalizeTimestamp(data.updatedAt),
        updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
      });
    },
    (error) => {
      if (onError) onError(error);
    }
  );
  void path;
}

export function subscribeToYouTubeVideos(
  onUpdate: (videos: YouTubeVideoRecord[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const q = query(collection(db, 'youtube_videos'), where('published', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: YouTubeVideoRecord[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        if (!d.videoId || !d.title) return;
        list.push({
          id: String(d.id || docSnap.id),
          videoId: String(d.videoId),
          url: String(d.url || `https://www.youtube.com/watch?v=${d.videoId}`),
          title: String(d.title),
          description: String(d.description || ''),
          thumbnailUrl: String(d.thumbnailUrl || ''),
          channelTitle: String(d.channelTitle || ''),
          published: Boolean(d.published),
          order: Number(d.order ?? 0),
          createdAt: normalizeTimestamp(d.createdAt),
          updatedAt: normalizeTimestamp(d.updatedAt),
        });
      });
      list.sort((a, b) => a.order - b.order || Date.parse(b.createdAt) - Date.parse(a.createdAt));
      onUpdate(list);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function syncSiteSettingsToFirestore(settings: SiteSettings): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(doc(db, 'settings', 'site'), {
      websiteName: settings.websiteName,
      websiteLogo: settings.websiteLogo || '',
      websiteTitle: settings.websiteTitle || settings.websiteName,
      websiteDescription: settings.websiteDescription || '',
      websiteAnnouncement: settings.websiteAnnouncement || '',
      registrationEnabled: Boolean(settings.registrationEnabled),
      maintenanceMode: Boolean(settings.maintenanceMode),
      websiteNotificationsEnabled: Boolean(settings.websiteNotificationsEnabled),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser.uid,
    });
  } catch (err) {
    console.warn('Firestore settings sync skipped:', err instanceof Error ? err.message : String(err));
  }
}

export async function syncYouTubeVideoToFirestore(video: YouTubeVideoRecord): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await setDoc(doc(db, 'youtube_videos', video.id), {
      id: video.id,
      videoId: video.videoId,
      url: video.url,
      title: video.title,
      description: video.description || '',
      thumbnailUrl: video.thumbnailUrl,
      channelTitle: video.channelTitle || '',
      published: Boolean(video.published),
      order: Number(video.order ?? 0),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Firestore YouTube video sync skipped:', err instanceof Error ? err.message : String(err));
  }
}

export async function deleteYouTubeVideoFromFirestore(id: string): Promise<void> {
  if (!auth.currentUser) return;
  try {
    await deleteDoc(doc(db, 'youtube_videos', id));
  } catch (err) {
    console.warn('Firestore YouTube delete skipped:', err instanceof Error ? err.message : String(err));
  }
}
