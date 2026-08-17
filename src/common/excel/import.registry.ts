import { Injectable, NotFoundException } from '@nestjs/common';
import { ImportResult, UploadedExcel } from './excel.types';

/**
 * What a module registers so the generic import controller can serve its
 * template + accept its uploads without a per-module controller.
 */
export interface Importer {
  /** Human filename (no extension) for the downloaded template. */
  templateFilename: string;
  /** Build the `.xlsx` template buffer. */
  template(): Promise<Buffer>;
  /** Parse + persist an uploaded file (all-or-nothing). */
  importRows(file: UploadedExcel): Promise<ImportResult>;
}

/**
 * Central registry of every importable resource. Each feature service registers
 * itself (in its constructor) under a URL slug, e.g. 'units', 'products',
 * 'chart-of-accounts'. The single {@link ImportController} looks resources up
 * here — so adding import to a new entity needs zero new routes.
 */
@Injectable()
export class ImportRegistry {
  private readonly importers = new Map<string, Importer>();

  register(resource: string, importer: Importer): void {
    this.importers.set(resource, importer);
  }

  get(resource: string): Importer {
    const importer = this.importers.get(resource);
    if (!importer) {
      throw new NotFoundException(`نوع الاستيراد «${resource}» غير معروف`);
    }
    return importer;
  }

  /** Registered resource slugs (for diagnostics). */
  list(): string[] {
    return [...this.importers.keys()].sort();
  }
}
