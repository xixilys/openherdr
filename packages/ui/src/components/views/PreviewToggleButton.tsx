import React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Icon } from "@/components/icon/Icon";
import { useI18n } from '@/lib/i18n';

type PreviewToggleButtonProps = {
  /** Current mode - determines which icon is displayed */
  currentMode: 'preview' | 'edit';
  /** Callback fired when toggle button is clicked */
  onToggle: () => void;
  disabled?: boolean;
  size?: 'sm' | 'icon';
};

/**
 * PreviewToggleButton - A toggle button for switching between preview and edit modes.
 * 
 * Displays an eye icon when in preview mode (indicating the content is visible/read-only)
 * and a slashed eye icon when in edit mode (indicating the content can be edited).
 */
export const PreviewToggleButton: React.FC<PreviewToggleButtonProps> = ({
  currentMode,
  onToggle,
  disabled,
  size = 'sm',
}) => {
  const { t } = useI18n();
  const isPreview = currentMode === 'preview';
  const ariaLabel = t(isPreview ? 'filesView.editor.switchToEditMode' : 'filesView.editor.switchToPreviewMode');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          disabled={disabled}
          onClick={onToggle}
          aria-label={ariaLabel}
          aria-pressed={isPreview}
          className={size === 'sm' ? 'h-5 w-5 p-0' : undefined}
        >
          {isPreview ? (
            <Icon name="eye" className="size-4"  aria-hidden="true"/>
          ) : (
            <Icon name="eye-off" className="size-4"  aria-hidden="true"/>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8}>
        {ariaLabel}
      </TooltipContent>
    </Tooltip>
  );
};
