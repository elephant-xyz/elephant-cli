import {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    afterEach,
    type MockInstance,
} from 'vitest';

// Prevent loading heavy browser-related code by mocking prepare
vi.mock('../../../src/lib/prepare', () => ({ prepare: vi.fn() }));

describe('lib import does not trigger CLI update check', () => {
    let exitSpy: MockInstance<[code?: string | number | null | undefined], never>;
    let fetchMock: ReturnType<typeof vi.fn>;
    let warnSpy: MockInstance<unknown[], void>;

    beforeEach(() => {
        vi.resetModules();
        exitSpy = vi
            .spyOn(process, 'exit')
            .mockImplementation(
                (_code?: string | number | null | undefined) => undefined as never
            );
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        delete process.env.ELEPHANT_CLI_ENTRY;
    });

    afterEach(() => {
        exitSpy.mockRestore();
        warnSpy.mockRestore();
        if (typeof (global as any).fetch !== 'undefined')
            delete (global as any).fetch;
    });

    it('does not call process.exit or fetch on lib import', async () => {
        const lib = await import('../../../src/lib/index');
        expect(typeof lib.transform).toBe('function');
        expect(fetchMock).not.toHaveBeenCalled();
        expect(exitSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
