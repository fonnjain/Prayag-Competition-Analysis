import { useGetCompetitors, useUpdateCompetitor, useDeleteCompetitor, useResetData, getGetCompetitorsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export default function Competitors() {
  const { data: competitors, isLoading } = useGetCompetitors();
  const updateComp = useUpdateCompetitor();
  const deleteComp = useDeleteCompetitor();
  const resetData = useResetData();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleToggleHide = (name: string, currentHidden: boolean) => {
    updateComp.mutate({ name, data: { hidden: !currentHidden } }, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast({ description: `Competitor ${!currentHidden ? 'hidden' : 'shown'}.` });
      }
    });
  };

  const handleDelete = (name: string) => {
    deleteComp.mutate({ name }, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast({ description: "Competitor removed." });
      }
    });
  };

  const handleReset = () => {
    resetData.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast({ description: "Data reset to original state." });
      }
    });
  };

  return (
    <div className="flex-1 p-6 space-y-6 max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Competitors</h2>
          <p className="text-muted-foreground">Manage rival brands and their visibility.</p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-destructive border-destructive/50 hover:bg-destructive/10">
              <AlertTriangle className="w-4 h-4 mr-2" />
              Reset to original data
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will erase all edits and imports, restoring the database to its initial seeded state. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleReset} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Yes, Reset Data
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Competitor List</CardTitle>
          <CardDescription>Hide or remove competitors from the comparison matrix.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Basis</TableHead>
                <TableHead className="text-right">Products</TableHead>
                <TableHead className="text-center">Visible</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({length: 3}).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : competitors?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No competitors found.</TableCell>
                </TableRow>
              ) : competitors?.map((comp) => (
                <TableRow key={comp.name}>
                  <TableCell className="font-medium">{comp.name}</TableCell>
                  <TableCell className="uppercase text-xs">{comp.basis}</TableCell>
                  <TableCell className="text-right font-mono">{comp.productsCompared}</TableCell>
                  <TableCell className="text-center">
                    <Switch 
                      checked={!comp.hidden} 
                      onCheckedChange={() => handleToggleHide(comp.name, comp.hidden)} 
                      disabled={updateComp.isPending}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(comp.name)}
                      disabled={deleteComp.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
