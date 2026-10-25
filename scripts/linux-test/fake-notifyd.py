#!/usr/bin/python3
# Servidor org.freedesktop.Notifications mínimo para o teste do clique: anuncia a capacidade "actions",
# registra cada Notify que o app envia e, 1,5 s depois de receber a notificação do teste ("clique" no título),
# emite ActionInvoked(id, "default") + NotificationClosed — exatamente o que o servidor do ambiente gráfico
# faz quando o usuário clica na notificação.
import json
from gi.repository import Gio, GLib

XML = """<node><interface name="org.freedesktop.Notifications">
 <method name="GetCapabilities"><arg direction="out" type="as"/></method>
 <method name="Notify"><arg direction="in" type="s"/><arg direction="in" type="u"/><arg direction="in" type="s"/><arg direction="in" type="s"/><arg direction="in" type="s"/><arg direction="in" type="as"/><arg direction="in" type="a{sv}"/><arg direction="in" type="i"/><arg direction="out" type="u"/></method>
 <method name="CloseNotification"><arg direction="in" type="u"/></method>
 <method name="GetServerInformation"><arg direction="out" type="s"/><arg direction="out" type="s"/><arg direction="out" type="s"/><arg direction="out" type="s"/></method>
 <signal name="NotificationClosed"><arg type="u"/><arg type="u"/></signal>
 <signal name="ActionInvoked"><arg type="u"/><arg type="s"/></signal>
</interface></node>"""
PATH, IFACE = '/org/freedesktop/Notifications', 'org.freedesktop.Notifications'
node = Gio.DBusNodeInfo.new_for_xml(XML)
counter = 0


def log(*args):
    print('[fake-notifyd]', *args, flush=True)


def on_call(conn, sender, path, iface, method, params, invocation):
    global counter
    if method != 'Notify':
        log('chamada', method, 'de', sender)
    if method == 'GetCapabilities':
        invocation.return_value(GLib.Variant('(as)', (['actions', 'body', 'persistence'],)))
    elif method == 'GetServerInformation':
        invocation.return_value(GLib.Variant('(ssss)', ('fake-notifyd', 'palette-test', '1.0', '1.2')))
    elif method == 'Notify':
        counter += 1
        app_name, replaces, icon, summary, body, actions, hints, timeout = params.unpack()
        nid = counter
        log('Notify de', sender, json.dumps({'id': nid, 'app': app_name, 'summary': summary, 'body': body, 'actions': list(actions), 'hints': {k: str(v)[:60] for k, v in hints.items()}}, ensure_ascii=False))
        invocation.return_value(GLib.Variant('(u)', (nid,)))
        if 'default' in actions and 'clique' in summary.lower():
            def click():
                log('ActionInvoked default ->', nid)
                conn.emit_signal(None, PATH, IFACE, 'ActionInvoked', GLib.Variant('(us)', (nid, 'default')))
                conn.emit_signal(None, PATH, IFACE, 'NotificationClosed', GLib.Variant('(uu)', (nid, 2)))
                return False
            GLib.timeout_add(1500, click)
    elif method == 'CloseNotification':
        (nid,) = params.unpack()
        log('CloseNotification', nid)
        invocation.return_value(None)


def on_bus(conn, name):
    conn.register_object(PATH, node.interfaces[0], on_call)
    log('objeto registrado')


Gio.bus_own_name(Gio.BusType.SESSION, IFACE, Gio.BusNameOwnerFlags.NONE, on_bus, lambda c, n: log('nome adquirido', n), lambda c, n: log('nome perdido', n))
GLib.MainLoop().run()
