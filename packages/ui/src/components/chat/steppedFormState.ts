import type { FormRequest } from '@/lib/opencode/model';
import { initialFormValues, type FormValues } from './formCardState';

type FormField = FormRequest['fields'][number];

export const steppedFormFieldsSignature = (fields: readonly FormField[]): string => JSON.stringify(fields);

export type SteppedFormState = {
    fieldsSignature: string;
    values: FormValues;
    step: number;
    collapsed: boolean;
    showErrors: boolean;
};

export const createSteppedFormState = (fields: readonly FormField[]): SteppedFormState => ({
    fieldsSignature: steppedFormFieldsSignature(fields),
    values: initialFormValues(fields),
    step: 0,
    collapsed: false,
    showErrors: false,
});

