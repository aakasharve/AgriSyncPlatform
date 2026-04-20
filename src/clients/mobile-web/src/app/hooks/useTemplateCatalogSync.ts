import { useEffect } from 'react';
import { setScheduleTemplatesFromReferenceData } from '../../infrastructure/reference/TemplateCatalog';
import { useScheduleTemplates } from './useReferenceData';

export function useTemplateCatalogSync(): void {
    const templates = useScheduleTemplates();

    useEffect(() => {
        setScheduleTemplatesFromReferenceData(templates ?? []);
    }, [templates]);
}
