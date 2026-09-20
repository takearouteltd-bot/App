// utils/changeRequests.js
// Drivers cannot change their name, phone number or documents directly.
// Instead they send a change request, which an admin approves or rejects on
// the dashboard. Approved changes are written to the driver record by the admin.
//
// changeRequests/{id}:
//   driverId, driverName, kind: 'detail' | 'document',
//   field, fieldLabel, currentValue, requestedValue, fileUrl,
//   note, status: 'pending' | 'approved' | 'rejected',
//   adminNote, createdAt, decidedAt, decidedBy
import { useEffect, useState } from 'react';
import { addDoc, collection, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../config/firebase';
import { uriToBlob } from '../helpers/uploadPicker';

export async function submitChangeRequest(driverId, driverName, request) {
  return addDoc(collection(db, 'changeRequests'), {
    driverId,
    driverName: driverName || '',
    kind: request.kind,
    field: request.field,
    fieldLabel: request.fieldLabel,
    currentValue: request.currentValue ?? null,
    requestedValue: request.requestedValue ?? null,
    fileUrl: request.fileUrl ?? null,
    note: request.note || '',
    status: 'pending',
    adminNote: '',
    createdAt: serverTimestamp(),
    decidedAt: null,
    decidedBy: null,
  });
}

// Uploads a replacement document to a pending folder. It only replaces the
// live document once an admin approves the request.
export async function uploadPendingDocument(driverId, docId, asset) {
  const isPdf = (asset.mimeType || '').includes('pdf') || /\.pdf$/i.test(asset.name || '');
  const ext = isPdf ? 'pdf' : 'jpg';
  const contentType = isPdf ? 'application/pdf' : 'image/jpeg';
  const path = `drivers/${driverId}/pending/${docId}_${Date.now()}.${ext}`;
  const blob = await uriToBlob(asset.uri);
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, blob, { contentType });
  blob.close?.();
  return getDownloadURL(fileRef);
}

// Live list of this driver's requests, newest first.
export function useChangeRequests(driverId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!driverId) return undefined;
    const q = query(collection(db, 'changeRequests'), where('driverId', '==', driverId));
    return onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        setItems(rows);
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [driverId]);

  return { items, loading, pendingFor: (field) => items.find((r) => r.field === field && r.status === 'pending') };
}
