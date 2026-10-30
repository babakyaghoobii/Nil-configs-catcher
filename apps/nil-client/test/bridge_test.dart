import 'dart:async';
import '../lib/nil_catcher_service.dart';

void check(bool value, String message) {
  if (!value) throw StateError(message);
}

Map<String, dynamic> fixture({
  String id = 'a',
  int total = 1,
  String state = 'success',
  String time = '2026-10-30T00:00:00Z',
}) {
  final status = <String, dynamic>{
    'schemaVersion': 1,
    'state': state,
    'added': 1,
    'totalUnique': total,
    'sources': [],
    'errors': [],
  };
  return {
    'snapshot': {
      'schemaVersion': 1,
      'totalUnique': total,
      'generatedAt': time,
      'configs': total == 0
          ? []
          : [
              {
                'id': id * 64,
                'uri': 'trojan://fixture@example.com:443',
                'protocol': 'trojan',
                'name': 'Test only',
                'host': 'example.com',
                'port': 443,
                'firstSeenAt': time,
                'sources': [],
              },
            ],
    },
    'status': status,
    'history': [status],
  };
}

Future<void> mustFail(FutureOr<void> Function() action) async {
  var failed = false;
  try {
    await action();
  } catch (_) {
    failed = true;
  }
  check(failed, 'Expected an error');
}

class FakeTransport implements NilTransport {
  final calls = <bool>[];
  Future<NilBatch> Function(bool collect) answer = (_) async =>
      NilBatch.parse(fixture());
  @override
  Future<NilBatch> request({required bool collect}) {
    calls.add(collect);
    return answer(collect);
  }
}

Future<void> main() async {
  var passed = 0;
  Future<void> test(String name, FutureOr<void> Function() body) async {
    await body();
    passed++;
    print('PASS $name');
  }

  await test(
    'coherent server batch preserves real URI and source timestamp',
    () {
      final data = NilBatch.parse(fixture());
      check(
        data.configs.single['uri'] == 'trojan://fixture@example.com:443',
        'URI altered',
      );
      check(data.totalUnique == 1 && data.added == 1, 'Counts altered');
    },
  );
  await test(
    'rejects mismatched totals, unknown protocol and controls',
    () async {
      final bad = fixture();
      (bad['snapshot'] as Map)['totalUnique'] = 2;
      await mustFail(() => NilBatch.parse(bad));
      final unknown = fixture();
      (unknown['snapshot']['configs'][0] as Map)['protocol'] = 'https';
      await mustFail(() => NilBatch.parse(unknown));
      final controls = fixture();
      (controls['snapshot']['configs'][0] as Map)['uri'] += '\n';
      await mustFail(() => NilBatch.parse(controls));
    },
  );
  await test('rejects duplicate IDs and invalid firstSeenAt', () async {
    final bad = fixture();
    bad['snapshot']['configs'].add(bad['snapshot']['configs'][0]);
    await mustFail(() => NilBatch.parse(bad));
    final invalidDate = fixture();
    invalidDate['snapshot']['configs'][0]['firstSeenAt'] = 'never';
    await mustFail(() => NilBatch.parse(invalidDate));
  });
  await test('initial sync imports a stable HTTPS NIL subscription', () async {
    final applied = <Uri>[];
    final fake = FakeTransport();
    final c = NilCatcherController(
      transport: fake,
      applySubscription: (url) async {
        applied.add(url);
      },
    );
    await c.synchronize();
    check(
      applied.length == 1 &&
          applied.single.scheme == 'https' &&
          applied.single.host ==
              'nil-config-catcher-babakyaghoobii.lovable.app',
      'Wrong subscription target',
    );
    check(applied.single.queryParameters['format'] == 'base64', 'Wrong format');
    c.dispose();
  });
  await test(
    'unchanged reads do not repeatedly import the same profile',
    () async {
      var applied = 0;
      final c = NilCatcherController(
        transport: FakeTransport(),
        applySubscription: (_) async {
          applied++;
        },
      );
      await c.synchronize();
      await c.synchronize();
      check(applied == 1, 'Repeated imports');
      c.dispose();
    },
  );
  await test(
    'new server records automatically update the same subscription',
    () async {
      var applied = 0;
      final fake = FakeTransport();
      final c = NilCatcherController(
        transport: fake,
        applySubscription: (_) async {
          applied++;
        },
      );
      await c.synchronize();
      fake.answer = (_) async => NilBatch.parse(fixture(id: 'b', total: 2));
      await c.synchronize();
      check(applied == 2 && c.batch!.totalUnique == 2, 'New batch not applied');
      c.dispose();
    },
  );
  await test(
    'manual refresh calls collection, not a read of the old snapshot',
    () async {
      final fake = FakeTransport();
      final c = NilCatcherController(
        transport: fake,
        applySubscription: (_) async {},
      );
      await c.synchronize(collect: true);
      check(fake.calls.single, 'Manual collection did not run');
      c.dispose();
    },
  );
  await test(
    'network failure retains last valid batch and reports error',
    () async {
      final fake = FakeTransport();
      final c = NilCatcherController(
        transport: fake,
        applySubscription: (_) async {},
      );
      await c.synchronize();
      final previous = c.batch;
      fake.answer = (_) async => throw const NilServiceException('Unavailable');
      await mustFail(() => c.synchronize(collect: true));
      check(
        identical(previous, c.batch) && c.error != null && !c.busy,
        'Failure erased data',
      );
      c.dispose();
    },
  );
  await test('failed collection is not presented as success', () async {
    var applied = 0;
    final fake = FakeTransport();
    final c = NilCatcherController(
      transport: fake,
      applySubscription: (_) async {
        applied++;
      },
    );
    await c.synchronize();
    final previous = c.batch;
    fake.answer = (_) async =>
        NilBatch.parse(fixture(id: 'b', state: 'failed'));
    await mustFail(() => c.synchronize(collect: true));
    check(
      identical(previous, c.batch) && applied == 1,
      'Failed run was applied',
    );
    c.dispose();
  });
  await test(
    'empty initial data never wipes or imports an empty profile',
    () async {
      var applied = 0;
      final fake = FakeTransport()
        ..answer = (_) async => NilBatch.parse(fixture(total: 0));
      final c = NilCatcherController(
        transport: fake,
        applySubscription: (_) async {
          applied++;
        },
      );
      await c.synchronize();
      check(applied == 0, 'Empty profile imported');
      c.dispose();
    },
  );
  await test('manual collection queues behind an in-flight read', () async {
    final read = Completer<NilBatch>();
    final fake = FakeTransport();
    fake.answer = (collect) =>
        collect ? Future.value(NilBatch.parse(fixture(id: 'b'))) : read.future;
    final c = NilCatcherController(
      transport: fake,
      applySubscription: (_) async {},
    );
    final a = c.synchronize();
    final b = c.synchronize(collect: true);
    read.complete(NilBatch.parse(fixture()));
    await Future.wait([a, b]);
    check(
      fake.calls.length == 2 && !fake.calls[0] && fake.calls[1],
      'Manual work replaced by an old read',
    );
    c.dispose();
  });
  await test('parallel manual taps share one real collection', () async {
    final reply = Completer<NilBatch>();
    final fake = FakeTransport()..answer = (_) => reply.future;
    final c = NilCatcherController(
      transport: fake,
      applySubscription: (_) async {},
    );
    final a = c.synchronize(collect: true);
    final b = c.synchronize(collect: true);
    reply.complete(NilBatch.parse(fixture()));
    await Future.wait([a, b]);
    check(fake.calls.length == 1, 'Duplicate concurrent collection');
    c.dispose();
  });
  await test('profile import failure is retried on the next sync', () async {
    var attempts = 0;
    final c = NilCatcherController(
      transport: FakeTransport(),
      applySubscription: (_) async {
        if (++attempts == 1) throw StateError('Repository unavailable');
      },
    );
    await mustFail(() => c.synchronize());
    await c.synchronize();
    check(attempts == 2 && c.error == null, 'Failed import was marked applied');
    c.dispose();
  });
  await test(
    'pause/dispose stop polling and suppress automatic errors',
    () async {
      final fake = FakeTransport()
        ..answer = (_) async => throw const NilServiceException('Offline');
      final c = NilCatcherController(
        transport: fake,
        applySubscription: (_) async {},
      );
      c.start(interval: const Duration(milliseconds: 5));
      await Future<void>.delayed(const Duration(milliseconds: 22));
      c.pause();
      final count = fake.calls.length;
      await Future<void>.delayed(const Duration(milliseconds: 15));
      check(count > 0 && count == fake.calls.length, 'Polling did not stop');
      c.dispose();
      await mustFail(() => c.synchronize());
    },
  );
  print(
    '$passed native synchronization bridge tests passed. VPN tunnel/OS installation is not exercised by these tests.',
  );
}
