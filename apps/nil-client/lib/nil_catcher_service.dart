import 'dart:async';
import 'dart:convert';
import 'dart:io';

const nilOrigin = String.fromEnvironment(
  'NIL_API_ORIGIN',
  defaultValue: 'https://nil-config-catcher-babakyaghoobii.lovable.app',
);
final nilSubscription = Uri.parse(
  '$nilOrigin/api/subscription?protocol=all&source=all&format=base64&title=NIL',
);
const nilProtocols = {'vless', 'vmess', 'trojan', 'ss', 'hysteria2', 'tuic'};

class NilServiceException implements Exception {
  const NilServiceException(this.message, {this.retryAfter = 0});
  final String message;
  final int retryAfter;
  @override
  String toString() => message;
}

class NilBatch {
  NilBatch._(this.configs, this.status, this.history, this.revision);
  final List<Map<String, dynamic>> configs;
  final Map<String, dynamic> status;
  final List<Map<String, dynamic>> history;
  final String revision;
  int get added => status['added'] as int;
  int get totalUnique => status['totalUnique'] as int;

  factory NilBatch.parse(dynamic value) {
    Never invalid() =>
        throw const NilServiceException('پاسخ دریافت‌شده معتبر نیست.');
    if (value is! Map<String, dynamic>) invalid();
    final snapshot = value['snapshot'];
    final status = value['status'];
    final history = value['history'];
    if (snapshot is! Map<String, dynamic> ||
        status is! Map<String, dynamic> ||
        history is! List ||
        history.length > 120)
      invalid();
    final rows = snapshot['configs'];
    if (snapshot['schemaVersion'] != 1 ||
        rows is! List ||
        rows.length > 1000 ||
        snapshot['totalUnique'] != status['totalUnique'])
      invalid();
    bool validStatus(dynamic item) =>
        item is Map<String, dynamic> &&
        item['schemaVersion'] == 1 &&
        {'success', 'partial', 'failed', 'never'}.contains(item['state']) &&
        item['added'] is int &&
        item['added'] >= 0 &&
        item['totalUnique'] is int &&
        item['totalUnique'] >= 0 &&
        item['sources'] is List &&
        item['errors'] is List;
    if (!validStatus(status) ||
        history.any((item) => !validStatus(item)) ||
        status['totalUnique'] < rows.length)
      invalid();
    final ids = <String>{};
    final configs = <Map<String, dynamic>>[];
    for (final row in rows) {
      if (row is! Map<String, dynamic>) invalid();
      final id = row['id'];
      final uri = row['uri'];
      final protocol = row['protocol'];
      if (id is! String ||
          !RegExp(r'^[a-f0-9]{64}$').hasMatch(id) ||
          !ids.add(id) ||
          !nilProtocols.contains(protocol))
        invalid();
      if (uri is! String ||
          uri.length > 16384 ||
          RegExp(r'[\s\x00-\x1f\x7f]').hasMatch(uri))
        invalid();
      final scheme = uri.split('://').first.toLowerCase();
      if ((scheme == 'hy2' ? 'hysteria2' : scheme) != protocol ||
          !uri.contains('://'))
        invalid();
      if (row['name'] is! String ||
          row['host'] is! String ||
          row['port'] is! int ||
          row['port'] < 1 ||
          row['port'] > 65535 ||
          row['sources'] is! List ||
          row['firstSeenAt'] is! String ||
          DateTime.tryParse(row['firstSeenAt']) == null)
        invalid();
      configs.add(Map<String, dynamic>.unmodifiable(row));
    }
    final revision =
        '${snapshot['generatedAt']}|${status['totalUnique']}|${configs.map((row) => row['id']).join(',')}';
    return NilBatch._(
      List.unmodifiable(configs),
      Map.unmodifiable(status),
      List.unmodifiable(
        history.map(
          (row) =>
              Map<String, dynamic>.unmodifiable(row as Map<String, dynamic>),
        ),
      ),
      revision,
    );
  }
}

abstract interface class NilTransport {
  Future<NilBatch> request({required bool collect});
}

/// Production requests have a fixed HTTPS origin. Config endpoints and user URLs
/// are never contacted by the synchronization bridge.
class NilHttpTransport implements NilTransport {
  @override
  Future<NilBatch> request({required bool collect}) async {
    final client = HttpClient()
      ..connectionTimeout = const Duration(seconds: 10);
    try {
      return await (() async {
        final uri = Uri.parse('$nilOrigin/api/${collect ? 'collect' : 'data'}');
        final request = await client.openUrl(collect ? 'POST' : 'GET', uri);
        request.followRedirects = false;
        request.headers.set(HttpHeaders.acceptHeader, 'application/json');
        if (collect) {
          request.headers.contentType = ContentType.json;
          request.write(jsonEncode({'limit': 50}));
        }
        final response = await request.close();
        if (response.statusCode == 429) {
          final retry =
              int.tryParse(response.headers.value('retry-after') ?? '') ?? 60;
          throw NilServiceException(
            'دریافت دیگری در حال انجام است؛ کمی بعد دوباره تلاش کن.',
            retryAfter: retry.clamp(0, 120).toInt(),
          );
        }
        if (response.statusCode != 200)
          throw const NilServiceException(
            'سرویس دریافت در دسترس نیست؛ کانفیگ‌های قبلی حفظ شده‌اند.',
          );
        const maximum = 8 * 1024 * 1024;
        if (response.contentLength > maximum)
          throw const NilServiceException('پاسخ بیش از حد بزرگ است.');
        final bytes = <int>[];
        await for (final chunk in response) {
          if (bytes.length + chunk.length > maximum)
            throw const NilServiceException('پاسخ بیش از حد بزرگ است.');
          bytes.addAll(chunk);
        }
        return NilBatch.parse(
          jsonDecode(utf8.decode(bytes, allowMalformed: false)),
        );
      })().timeout(Duration(seconds: collect ? 45 : 15));
    } finally {
      client.close(force: true);
    }
  }
}

/// Imports/updates ONE stable public subscription in the host client's existing
/// profile repository. Existing user subscriptions and selected profiles remain
/// under the host client's control. This class does not implement a VPN tunnel.
class NilCatcherController {
  NilCatcherController({
    NilTransport? transport,
    required this.applySubscription,
    this.onChanged,
  }) : transport = transport ?? NilHttpTransport();
  final NilTransport transport;
  final Future<void> Function(Uri subscription) applySubscription;
  final void Function()? onChanged;
  NilBatch? batch;
  String? error;
  bool busy = false;
  bool _collecting = false;
  bool _disposed = false;
  String? _appliedRevision;
  Future<NilBatch>? _operation;
  Timer? _timer;

  Future<NilBatch> synchronize({bool collect = false}) async {
    if (_disposed) throw StateError('Controller disposed');
    if (_operation case final Future<NilBatch> pending) {
      if (!collect || _collecting) return pending;
      try {
        await pending;
      } catch (_) {
        /* A manual run can recover a failed read. */
      }
      return synchronize(collect: true);
    }
    busy = true;
    _collecting = collect;
    error = null;
    final completer = Completer<NilBatch>();
    _operation = completer.future;
    onChanged?.call();
    try {
      final fresh = await transport.request(collect: collect);
      if (_disposed) throw StateError('Controller disposed');
      if (collect && fresh.status['state'] == 'failed')
        throw const NilServiceException(
          'جمع‌آوری تازه موفق نشد؛ کانفیگ‌های قبلی حفظ شده‌اند.',
        );
      batch = fresh;
      if (fresh.configs.isNotEmpty && fresh.revision != _appliedRevision) {
        await applySubscription(nilSubscription);
        _appliedRevision = fresh.revision;
      }
      completer.complete(fresh);
    } catch (failure, stack) {
      error = failure is NilServiceException
          ? failure.message
          : 'دریافت یا افزودن کانفیگ‌ها انجام نشد؛ داده‌های قبلی حفظ شده‌اند.';
      completer.completeError(failure, stack);
    } finally {
      busy = false;
      _operation = null;
      _collecting = false;
      if (!_disposed) onChanged?.call();
    }
    return completer.future;
  }

  /// Polls while the app is active. OS background restrictions still apply.
  void start({Duration interval = const Duration(minutes: 2)}) {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) {
      if (!busy)
        unawaited(
          synchronize().then<void>(
            (_) {},
            onError: (Object _, StackTrace __) {},
          ),
        );
    });
  }

  void pause() {
    _timer?.cancel();
    _timer = null;
  }

  void dispose() {
    pause();
    _disposed = true;
  }
}
