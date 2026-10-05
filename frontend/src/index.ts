import { faCubes } from '@fortawesome/free-solid-svg-icons';
import { Extension, type ExtensionContext } from 'shared';
import NbtEditorPage from './pages/NbtEditorPage.tsx';
import { getExtTranslations } from './translations.ts';

class CaloptreyxNbtEditorExtension extends Extension {
  public initialize(ctx: ExtensionContext): void {
    ctx.extensionRegistry.enterRoutes((routes) =>
      routes.addServerRoute({
        name: () => getExtTranslations().t('common.nbtEditor', {}),
        icon: faCubes,
        path: '/nbt-editor',
        element: NbtEditorPage,
        permission: 'files.read-content',
      }),
    );
  }
}

export default new CaloptreyxNbtEditorExtension();
