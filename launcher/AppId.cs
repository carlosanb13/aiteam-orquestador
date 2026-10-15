// Lee y escribe el "AppUserModelID" con el que Windows agrupa ventanas y accesos directos en la barra de tareas.
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class AITeamAppId
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant
    {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr p;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        int GetCount(out uint c);
        int GetAt(uint i, out PropertyKey k);
        int GetValue(ref PropertyKey k, out PropVariant v);
        int SetValue(ref PropertyKey k, ref PropVariant v);
        int Commit();
    }

    [DllImport("shell32.dll")]
    static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid riid, out IPropertyStore store);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHGetPropertyStoreFromParsingName(string path, IntPtr bc, int flags, ref Guid riid, out IPropertyStore store);

    [DllImport("ole32.dll")]
    static extern int PropVariantClear(ref PropVariant v);

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);

    static PropertyKey AppIdKey = new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    static Guid StoreIid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");

    /// AppUserModelID de la primera ventana visible cuyo título es exactamente el indicado.
    public static string ForWindowTitled(string title)
    {
        string found = null;
        EnumWindows((h, l) =>
        {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString() != title) return true;
            IPropertyStore store;
            if (SHGetPropertyStoreForWindow(h, ref StoreIid, out store) != 0 || store == null) return true;
            PropVariant v;
            if (store.GetValue(ref AppIdKey, out v) == 0 && v.vt == 31) found = Marshal.PtrToStringUni(v.p);
            PropVariantClear(ref v);
            return found == null;
        }, IntPtr.Zero);
        return found;
    }

    /// Títulos y AppUserModelID de las ventanas visibles cuyo título contiene el texto (para diagnóstico).
    public static string[] Describe(string contains)
    {
        var list = new System.Collections.Generic.List<string>();
        EnumWindows((h, l) =>
        {
            if (!IsWindowVisible(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, sb.Capacity);
            var title = sb.ToString();
            if (title.IndexOf(contains, StringComparison.OrdinalIgnoreCase) < 0) return true;
            string id = "(sin store)";
            try {
            IPropertyStore store;
            if (SHGetPropertyStoreForWindow(h, ref StoreIid, out store) == 0 && store != null)
            {
                PropVariant v;
                id = (store.GetValue(ref AppIdKey, out v) == 0 && v.vt == 31) ? Marshal.PtrToStringUni(v.p) : "(vt=" + v.vt + ")";
                PropVariantClear(ref v);
            }
            } catch (Exception ex) { id = "ERR " + ex.ToString(); }
            list.Add(title + " => " + id);
            return true;
        }, IntPtr.Zero);
        return list.ToArray();
    }

    /// Escribe el AppUserModelID en un acceso directo (.lnk).
    public static void SetOnShortcut(string lnkPath, string appId)
    {
        IPropertyStore store;
        int hr = SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2 /* GPS_READWRITE */, ref StoreIid, out store);
        if (hr != 0) throw new Exception("No se pudo abrir el acceso directo: 0x" + hr.ToString("X"));
        var v = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(appId) };
        try
        {
            Marshal.ThrowExceptionForHR(store.SetValue(ref AppIdKey, ref v));
            Marshal.ThrowExceptionForHR(store.Commit());
        }
        finally
        {
            PropVariantClear(ref v);
        }
    }
}
