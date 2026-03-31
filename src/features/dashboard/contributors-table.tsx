"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GitHubContributor } from "@/types/github";

export function ContributorsTable({
  contributors,
  loading,
}: {
  contributors: GitHubContributor[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top contributors</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Commits</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contributors.slice(0, 12).map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <a
                    href={c.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 hover:underline"
                  >
                    <Avatar className="size-7">
                      <AvatarImage src={c.avatar_url} alt="" />
                      <AvatarFallback>{c.login.slice(0, 2)}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{c.login}</span>
                  </a>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.contributions}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
