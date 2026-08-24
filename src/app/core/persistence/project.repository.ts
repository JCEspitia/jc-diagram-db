import { Injectable } from '@angular/core';
import { DiagramProject } from '../schema';

export abstract class ProjectRepository {
  abstract loadLastProject(): Promise<DiagramProject | null>;
  abstract saveProject(project: DiagramProject): Promise<void>;
}

const DATABASE_NAME = 'diagramdb';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'projects';
const SESSION_STORE = 'session';
const LAST_PROJECT_KEY = 'lastProjectId';

@Injectable({ providedIn: 'root' })
export class IndexedDbProjectRepository extends ProjectRepository {
  async loadLastProject(): Promise<DiagramProject | null> {
    const database = await this.open();
    if (!database) return null;
    try {
      const projectId = await requestResult<string | undefined>(
        database
          .transaction(SESSION_STORE, 'readonly')
          .objectStore(SESSION_STORE)
          .get(LAST_PROJECT_KEY),
      );
      if (!projectId) return null;
      const project = await requestResult<unknown>(
        database.transaction(PROJECT_STORE, 'readonly').objectStore(PROJECT_STORE).get(projectId),
      );
      return isDiagramProject(project) ? project : null;
    } finally {
      database.close();
    }
  }

  async saveProject(project: DiagramProject): Promise<void> {
    const database = await this.open();
    if (!database) return;
    try {
      const transaction = database.transaction([PROJECT_STORE, SESSION_STORE], 'readwrite');
      transaction.objectStore(PROJECT_STORE).put(project);
      transaction.objectStore(SESSION_STORE).put(project.id, LAST_PROJECT_KEY);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  private open(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(PROJECT_STORE)) {
          database.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          database.createObjectStore(SESSION_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked.'));
    });
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted.'));
  });
}

export function isDiagramProject(value: unknown): value is DiagramProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<DiagramProject>;
  return (
    project.format === 'diagramdb' &&
    project.formatVersion === 1 &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.dbml === 'string' &&
    typeof project.createdAt === 'string' &&
    typeof project.updatedAt === 'string' &&
    Boolean(project.schema && Array.isArray(project.schema.tables)) &&
    Boolean(project.layout?.tables && project.layout.viewport)
  );
}
